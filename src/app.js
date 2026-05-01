(function () {
  "use strict";

  var engine = window.ChessPlus;
  var boardElement = document.getElementById("board");
  var statusText = document.getElementById("status-text");
  var variantSummary = document.getElementById("variant-summary");
  var moveLog = document.getElementById("move-log");
  var opponentForm = document.getElementById("opponent-form");
  var computerModeInput = opponentForm.querySelector('input[name="opponentMode"][value="computer"]');
  var computerModeCopy = document.getElementById("computer-mode-copy");
  var variantForm = document.getElementById("variant-form");
  var computerSideSelect = document.getElementById("computer-side-select");
  var computerLevelSelect = document.getElementById("computer-level-select");
  var computerEngineSelect = document.getElementById("computer-engine-select");
  var engineInfoButton = document.getElementById("engine-info-button");
  var computerDisclaimer = document.getElementById("computer-disclaimer");
  var computerOnlyControls = Array.prototype.slice.call(document.querySelectorAll(".computer-only-control"));
  var newGameButton = document.getElementById("new-game-button");
  var undoButton = document.getElementById("undo-button");
  var statusCard = document.querySelector(".status-card");
  var boardPanel = document.querySelector(".board-panel");
  var promotionPanel = document.getElementById("promotion-panel");
  var promotionText = document.getElementById("promotion-text");
  var promotionCancelButton = document.getElementById("promotion-cancel-button");
  var promotionButtons = Array.prototype.slice.call(document.querySelectorAll(".promotion-option"));
  var engineInfoModal = document.getElementById("engine-info-modal");
  var engineInfoCloseButton = document.getElementById("engine-info-close-button");
  var VARIANT_SETTINGS_STORAGE_KEY = "chaos-chess.variant-settings";
  var VARIANT_ML_MODEL_URL = "./assets/models/variant-ml-hybrid-v1.json";
  var classicWorkerEngine = typeof window.Worker === "function" &&
    window.ChessPlusAI &&
    window.ChessPlusAI.ClassicEngine
    ? new window.ChessPlusAI.ClassicEngine({
      workerUrl: "./vendor/stockfish/stockfish-18-lite-single.js"
    })
    : null;
  var stockfishComputer = classicWorkerEngine &&
    window.ChessPlusComputer &&
    window.ChessPlusComputer.StockfishAdapter
    ? new window.ChessPlusComputer.StockfishAdapter({
      classicEngine: classicWorkerEngine
    })
    : null;
  var variantSearchComputer = window.ChessPlusComputer &&
    window.ChessPlusComputer.SearchVariantEngine
    ? new window.ChessPlusComputer.SearchVariantEngine()
    : null;
  var heuristicVariantComputer = window.ChessPlusComputer &&
    window.ChessPlusComputer.HeuristicVariantEngine
    ? new window.ChessPlusComputer.HeuristicVariantEngine()
    : null;
  var variantMlHybridComputer = null;
  var selectedSquare = null;
  var legalMoves = [];
  var lastMove = null;
  var pendingPromotion = null;
  var aiThinking = false;
  var aiRequestToken = 0;
  var newGameFeedbackTimeout = null;
  var computerUnavailableReasons = {};
  var squares = [];
  var game = new engine.ChessGame(engine.DEFAULT_RULES);

  function loadSavedRules() {
    var rawValue;

    try {
      rawValue = window.localStorage.getItem(VARIANT_SETTINGS_STORAGE_KEY);
    } catch (error) {
      return engine.DEFAULT_RULES;
    }

    if (!rawValue) {
      return engine.DEFAULT_RULES;
    }

    try {
      return engine.normalizeRules(JSON.parse(rawValue));
    } catch (error) {
      return engine.DEFAULT_RULES;
    }
  }

  function saveRules(rules) {
    try {
      window.localStorage.setItem(
        VARIANT_SETTINGS_STORAGE_KEY,
        JSON.stringify(engine.normalizeRules(rules))
      );
    } catch (error) {
      return;
    }
  }

  function currentRulesFromForm() {
    return {
      friendlyFire: variantForm.elements.friendlyFire.checked,
      kamikaze: variantForm.elements.kamikaze.checked,
      wrapAround: variantForm.elements.wrapAround.checked,
      doubleDirectionPawns: variantForm.elements.doubleDirectionPawns.checked,
      jumpPawns: variantForm.elements.jumpPawns.checked
    };
  }

  function applyRulesToForm(rules) {
    var normalizedRules = engine.normalizeRules(rules);

    variantForm.elements.friendlyFire.checked = normalizedRules.friendlyFire;
    variantForm.elements.kamikaze.checked = normalizedRules.kamikaze;
    variantForm.elements.wrapAround.checked = normalizedRules.wrapAround;
    variantForm.elements.doubleDirectionPawns.checked = normalizedRules.doubleDirectionPawns;
    variantForm.elements.jumpPawns.checked = normalizedRules.jumpPawns;
  }

  function currentOpponentSettings() {
    return {
      mode: opponentForm.elements.opponentMode.value === "computer" ? "computer" : "human",
      side: computerSideSelect.value === "w" ? "w" : "b",
      moveTime: Number(computerLevelSelect.value) || 600,
      engineId: computerEngineSelect.value || "auto"
    };
  }

  function getBackendById(backendId) {
    switch (backendId) {
      case "classic-stockfish":
        return stockfishComputer;
      case "variant-search-prototype":
        return variantSearchComputer;
      case "variant-ml-hybrid":
        return variantMlHybridComputer;
      case "prototype-heuristic":
        return heuristicVariantComputer;
      default:
        return null;
    }
  }

  function backendSupportsRules(backend, rules) {
    var info = getBackendInfo(backend);

    return Boolean(info && typeof info.supportsRules === "function" && info.supportsRules(rules));
  }

  function getDefaultComputerBackendForRules(rules) {
    if (engine.isClassicRules(rules) && stockfishComputer) {
      return stockfishComputer;
    }

    if (variantSearchComputer) {
      return variantSearchComputer;
    }

    if (heuristicVariantComputer) {
      return heuristicVariantComputer;
    }

    return engine.isClassicRules(rules) ? stockfishComputer : null;
  }

  function getComputerBackendForRules(rules) {
    var settings = currentOpponentSettings();
    var requestedBackend = settings.engineId === "auto" ? null : getBackendById(settings.engineId);

    if (requestedBackend) {
      return backendSupportsRules(requestedBackend, rules) ? requestedBackend : null;
    }

    return getDefaultComputerBackendForRules(rules);
  }

  function getAnyComputerBackend() {
    return stockfishComputer || variantSearchComputer || variantMlHybridComputer || heuristicVariantComputer;
  }

  function getSelectedComputerBackend() {
    return getComputerBackendForRules(currentRulesFromForm());
  }

  function getActiveComputerBackend() {
    if (!isComputerModeEnabled()) {
      return null;
    }

    return getComputerBackendForRules(game.state.rules);
  }

  function getBackendInfo(backend) {
    return backend ? backend.getInfo() : null;
  }

  function backendLabel(info) {
    if (!info) {
      return "Unavailable";
    }

    return info.label;
  }

  function engineSelectionSummary(rules) {
    var settings = currentOpponentSettings();
    var requestedBackend = getBackendById(settings.engineId);
    var defaultBackend = getDefaultComputerBackendForRules(rules);

    if (settings.engineId === "auto") {
      return "Auto (" + backendLabel(getBackendInfo(defaultBackend)) + ")";
    }

    if (!requestedBackend) {
      return "Unavailable";
    }

    return backendLabel(getBackendInfo(requestedBackend));
  }

  function engineGuidanceText(engineId) {
    if (engineId === "prototype-heuristic") {
      return "Heuristic Baseline is the weakest engine and mainly useful for quick experiments.";
    }

    if (engineId === "variant-ml-hybrid") {
      return "Variant ML Hybrid blends a learned evaluator into the custom variant search. Think Time still matters because search remains in the loop.";
    }

    if (engineId === "classic-stockfish" || engineId === "variant-search-prototype") {
      return "Think Time controls search budget. Higher values usually improve move quality.";
    }

    return "Auto uses Stockfish for classic chess and Variant Search for variants. Think Time affects the search engines.";
  }

  function getVariantMlLoadErrorMessage() {
    if (window.location.protocol === "file:") {
      return "Variant ML Hybrid needs the app served over http:// or https:// so the bundled model can load. Use make serve locally.";
    }

    return "Variant ML Hybrid could not load its bundled model.";
  }

  function loadVariantMlHybridEngine() {
    if (!window.fetch ||
      !window.ChessPlusComputer ||
      !window.ChessPlusComputer.ModelVariantEngine) {
      return Promise.resolve(null);
    }

    return window.fetch(VARIANT_ML_MODEL_URL).then(function onResponse(response) {
      if (!response.ok) {
        throw new Error("Variant ML model request failed with status " + response.status + ".");
      }

      return response.json();
    }).then(function onModelLoaded(payload) {
      variantMlHybridComputer = new window.ChessPlusComputer.ModelVariantEngine({
        id: "variant-ml-hybrid",
        label: payload.label || "Variant ML Hybrid",
        valueModel: payload,
        modelBlendWeight: 0.10,
        supportsRules: function supportsRules(rules) {
          return !engine.isClassicRules(rules);
        }
      });
      clearBackendError(variantMlHybridComputer);
      render();
      return variantMlHybridComputer;
    }).catch(function onModelError(error) {
      computerUnavailableReasons["variant-ml-hybrid"] = getVariantMlLoadErrorMessage();

      if (window.console && typeof window.console.error === "function") {
        window.console.error(error);
      }

      render();
      return null;
    });
  }

  function showNewGameFeedback() {
    if (newGameFeedbackTimeout) {
      window.clearTimeout(newGameFeedbackTimeout);
    }

    newGameButton.textContent = "New Game Started";
    newGameButton.classList.add("action-confirm");

    if (statusCard) {
      statusCard.classList.remove("reset-flash");
      void statusCard.offsetWidth;
      statusCard.classList.add("reset-flash");
    }

    if (boardPanel) {
      boardPanel.classList.remove("reset-flash");
      void boardPanel.offsetWidth;
      boardPanel.classList.add("reset-flash");
    }

    newGameFeedbackTimeout = window.setTimeout(function resetNewGameFeedback() {
      newGameButton.textContent = "Start New Game";
      newGameButton.classList.remove("action-confirm");

      if (statusCard) {
        statusCard.classList.remove("reset-flash");
      }

      if (boardPanel) {
        boardPanel.classList.remove("reset-flash");
      }

      newGameFeedbackTimeout = null;
    }, 1100);
  }

  function getBackendError(backend) {
    var info = getBackendInfo(backend);

    return info ? computerUnavailableReasons[info.id] || null : null;
  }

  function clearComputerErrors() {
    computerUnavailableReasons = {};
  }

  function clearBackendError(backend) {
    var info = getBackendInfo(backend);

    if (info && computerUnavailableReasons[info.id]) {
      delete computerUnavailableReasons[info.id];
    }
  }

  function buildAxisLabels() {
    var topFiles = document.querySelector(".file-labels.top");
    var bottomFiles = document.querySelector(".file-labels.bottom");
    var leftRanks = document.querySelector(".rank-labels.left");
    var rightRanks = document.querySelector(".rank-labels.right");
    var fileMarkup = "";
    var rankMarkup = "";
    var fileIndex;
    var rank;

    for (fileIndex = 0; fileIndex < 8; fileIndex += 1) {
      fileMarkup += "<span>" + engine.FILES[fileIndex] + "</span>";
    }

    for (rank = 8; rank >= 1; rank -= 1) {
      rankMarkup += "<span>" + rank + "</span>";
    }

    topFiles.innerHTML = fileMarkup;
    bottomFiles.innerHTML = fileMarkup;
    leftRanks.innerHTML = rankMarkup;
    rightRanks.innerHTML = rankMarkup;
  }

  function squareKey(x, y) {
    return x + "," + y;
  }

  function clearSelection() {
    selectedSquare = null;
    legalMoves = [];
  }

  function legalMoveMap() {
    var map = new Map();
    var index;

    for (index = 0; index < legalMoves.length; index += 1) {
      map.set(squareKey(legalMoves[index].to.x, legalMoves[index].to.y), legalMoves[index]);
    }

    return map;
  }

  function renderStatus() {
    var analysis = game.analysis;
    var backendInfo = getBackendInfo(getActiveComputerBackend());
    var turnName = game.state.turn === "w" ? "White" : "Black";

    if (pendingPromotion) {
      statusText.textContent = (pendingPromotion.color === "w" ? "White" : "Black") + " must choose a promotion piece.";
    } else if (aiThinking) {
      statusText.textContent = turnName + " " + (backendInfo ? backendInfo.label : "computer") + " is thinking.";
    } else if (analysis.status === "checkmate") {
      statusText.textContent = (analysis.winner === "w" ? "White" : "Black") + " wins by checkmate.";
    } else if (analysis.status === "stalemate") {
      statusText.textContent = "Stalemate.";
    } else if (analysis.status === "invalid") {
      statusText.textContent = analysis.reason;
    } else if (analysis.inCheck) {
      statusText.textContent = turnName + " to move, in check.";
    } else {
      statusText.textContent = turnName + " to move.";
    }

    variantSummary.textContent = opponentSummaryText() + "\n" + engine.rulesSummary(game.state.rules);
    undoButton.disabled = !pendingPromotion && game.history.length === 0;
  }

  function isComputerModeEnabled() {
    return currentOpponentSettings().mode === "computer";
  }

  function getComputerColor() {
    return currentOpponentSettings().side;
  }

  function canUseComputerPlayer() {
    var backend = getActiveComputerBackend();

    return Boolean(backend) &&
      !getBackendError(backend) &&
      isComputerModeEnabled();
  }

  function opponentSummaryText() {
    var settings = currentOpponentSettings();
    var backend = getActiveComputerBackend();
    var backendInfo = getBackendInfo(backend);

    if (settings.mode !== "computer") {
      return "Human vs Human";
    }

    if (!backend || getBackendError(backend)) {
      return "Computer Unavailable";
    }

    return "Vs Computer (" +
      (settings.side === "w" ? "White" : "Black") +
      " • " + backendInfo.label +
      ")";
  }

  function isComputerTurn() {
    return canUseComputerPlayer() &&
      !pendingPromotion &&
      game.analysis.status === "active" &&
      game.state.turn === getComputerColor();
  }

  function updateOpponentUI() {
    var settings = currentOpponentSettings();
    var selectedRules = currentRulesFromForm();
    var activeBackend = getActiveComputerBackend();
    var selectedBackend = getSelectedComputerBackend();
    var activeInfo = getBackendInfo(activeBackend);
    var selectedInfo = getBackendInfo(selectedBackend);
    var controlsEnabled = Boolean(getAnyComputerBackend()) && settings.mode === "computer";
    var selectedEngineLabel = engineSelectionSummary(selectedRules);
    var stockfishOption = computerEngineSelect.querySelector('option[value="classic-stockfish"]');
    var variantMlOption = computerEngineSelect.querySelector('option[value="variant-ml-hybrid"]');
    var showComputerControls = settings.mode === "computer";

    computerModeInput.disabled = !getAnyComputerBackend();
    computerSideSelect.disabled = !controlsEnabled;
    computerLevelSelect.disabled = !controlsEnabled;
    computerEngineSelect.disabled = !controlsEnabled;
    stockfishOption.disabled = !stockfishComputer || !engine.isClassicRules(selectedRules);
    if (variantMlOption) {
      variantMlOption.disabled = !variantMlHybridComputer || engine.isClassicRules(selectedRules);
    }
    computerModeCopy.textContent = "Engine: " + selectedEngineLabel;
    computerModeCopy.hidden = !showComputerControls;
    computerModeCopy.style.display = showComputerControls ? "" : "none";
    computerOnlyControls.forEach(function toggleComputerOnlyControl(element) {
      element.hidden = !showComputerControls;
      element.style.display = showComputerControls ? "" : "none";
    });

    if (!getAnyComputerBackend()) {
      computerDisclaimer.textContent = "Computer play is unavailable in this browser.";
      return;
    }

    if (settings.mode !== "computer") {
      computerDisclaimer.textContent = "Choose a side and start a new game.";
      return;
    }

    if (!selectedBackend) {
      computerDisclaimer.textContent = "The selected engine does not support this ruleset.";
      return;
    }

    if (activeBackend && getBackendError(activeBackend)) {
      computerDisclaimer.textContent = getBackendError(activeBackend);
      return;
    }

    if (selectedBackend && getBackendError(selectedBackend)) {
      computerDisclaimer.textContent = getBackendError(selectedBackend);
      return;
    }

    if (aiThinking && activeInfo) {
      computerDisclaimer.textContent = activeInfo.label + " is thinking.";
      return;
    }

    if (game.analysis.status !== "active") {
      computerDisclaimer.textContent = "Start a new game to play against " +
        backendLabel(selectedInfo) + ".";
      return;
    }

    if (!activeBackend) {
      computerDisclaimer.textContent = "The current game does not support the selected engine. Start a new game or choose another engine.";
      return;
    }

    computerDisclaimer.textContent = engineGuidanceText(settings.engineId);
  }

  function renderMoveLog() {
    var markup = "";
    var index;

    if (game.moveHistory.length === 0) {
      moveLog.innerHTML = "<li class=\"move-empty\">No moves yet.</li>";
      return;
    }

    for (index = 0; index < game.moveHistory.length; index += 1) {
      markup += "<li>" + game.moveHistory[index] + "</li>";
    }

    moveLog.innerHTML = markup;
  }

  function isPromotionMove(move) {
    return move && move.piece && move.piece.type === "p" && (move.to.y === 0 || move.to.y === 7);
  }

  function hidePromotionChooser() {
    pendingPromotion = null;

    if (typeof promotionPanel.close === "function" && promotionPanel.open) {
      promotionPanel.close();
      return;
    }

    promotionPanel.hidden = true;
  }

  function closeEngineInfo() {
    document.body.classList.remove("dialog-open");

    if (typeof engineInfoModal.close === "function" && engineInfoModal.open) {
      engineInfoModal.close();
      return;
    }

    engineInfoModal.hidden = true;
  }

  function openEngineInfo() {
    document.body.classList.add("dialog-open");

    if (typeof engineInfoModal.showModal === "function") {
      engineInfoModal.showModal();
    } else {
      engineInfoModal.hidden = false;
    }

    engineInfoCloseButton.focus();
  }

  function showPromotionChooser(move) {
    pendingPromotion = {
      from: { x: move.from.x, y: move.from.y },
      to: { x: move.to.x, y: move.to.y },
      color: move.piece.color
    };
    promotionText.textContent = "Choose a piece for the pawn on " + engine.coordToAlgebraic(move.to.x, move.to.y) + ".";

    if (typeof promotionPanel.showModal === "function") {
      promotionPanel.showModal();
    } else {
      promotionPanel.hidden = false;
    }

    if (promotionButtons.length > 0) {
      promotionButtons[0].focus();
    }
  }

  function renderBoard() {
    var moveTargets = legalMoveMap();
    var x;
    var y;
    var index;
    var squareButton;
    var piece;
    var isLight;
    var targetMove;
    var pieceGlyph;
    var pieceMarkup;
    var classes;

    if (squares.length === 0) {
      for (y = 0; y < 8; y += 1) {
        for (x = 0; x < 8; x += 1) {
          squareButton = document.createElement("button");
          squareButton.type = "button";
          squareButton.className = "square";
          squareButton.dataset.x = String(x);
          squareButton.dataset.y = String(y);
          squareButton.addEventListener("click", onSquareClick);
          squares.push(squareButton);
          boardElement.appendChild(squareButton);
        }
      }
    }

    for (index = 0; index < squares.length; index += 1) {
      x = Number(squares[index].dataset.x);
      y = Number(squares[index].dataset.y);
      piece = game.getPieceAt(x, y);
      isLight = (x + y) % 2 === 0;
      targetMove = moveTargets.get(squareKey(x, y));
      pieceGlyph = piece ? engine.PIECE_GLYPHS[piece.color][piece.type] : "";
      pieceMarkup = piece ? "<span class=\"piece " + (piece.color === "w" ? "white" : "black") + "\">" + pieceGlyph + "</span>" : "";
      classes = ["square", isLight ? "light" : "dark"];

      if (selectedSquare && selectedSquare.x === x && selectedSquare.y === y) {
        classes.push("selected");
      }

      if (targetMove) {
        classes.push(targetMove.capture ? "capture" : "legal");
      }

      if (lastMove) {
        if (lastMove.from.x === x && lastMove.from.y === y) {
          classes.push("last-from");
        }

        if (lastMove.to.x === x && lastMove.to.y === y) {
          classes.push("last-to");
        }
      }

      squares[index].className = classes.join(" ");
      squares[index].innerHTML = pieceMarkup;
      squares[index].setAttribute("aria-label", squareAriaLabel(x, y, piece, targetMove));
    }
  }

  function squareAriaLabel(x, y, piece, move) {
    var label = engine.coordToAlgebraic(x, y);

    if (piece) {
      label += ", " + (piece.color === "w" ? "white " : "black ") + engine.PIECE_NAMES[piece.type];
    }

    if (move) {
      label += move.capture ? ", capture" : ", legal move";
    }

    return label;
  }

  function render() {
    updateOpponentUI();
    renderStatus();
    renderMoveLog();
    renderBoard();
  }

  function cancelComputerTurn() {
    aiRequestToken += 1;
    aiThinking = false;

    if (stockfishComputer) {
      stockfishComputer.reset();
    }

    if (heuristicVariantComputer) {
      heuristicVariantComputer.reset();
    }

    if (variantSearchComputer) {
      variantSearchComputer.reset();
    }

    if (variantMlHybridComputer) {
      variantMlHybridComputer.reset();
    }
  }

  function getComputerFailureMessage(backend) {
    var backendInfo = getBackendInfo(backend);

    if (backendInfo &&
      backendInfo.id === "classic-stockfish" &&
      window.location.protocol === "file:") {
      return "Stockfish needs the app to be served over http:// or https://. Use make serve to enable it locally.";
    }

    if (backendInfo) {
      return backendInfo.label + " could not start. Start a new game to retry.";
    }

    return "Computer play could not start. Start a new game to retry.";
  }

  function handleComputerFailure(backend, error) {
    var backendInfo = getBackendInfo(backend);

    if (window.console && typeof window.console.error === "function") {
      window.console.error(error);
    }

    if (backendInfo) {
      computerUnavailableReasons[backendInfo.id] = getComputerFailureMessage(backend);
    }

    aiThinking = false;

    if (backend) {
      backend.reset();
    }
  }

  function applyComputerMove(moveChoice) {
    var result;

    if (!moveChoice || !moveChoice.from || !moveChoice.to) {
      throw new Error("Computer backend returned an invalid move.");
    }

    result = game.move(
      moveChoice.from.x,
      moveChoice.from.y,
      moveChoice.to.x,
      moveChoice.to.y,
      moveChoice.promotion
    );

    if (!result.ok) {
      throw new Error("Computer backend returned an illegal move.");
    }

    lastMove = {
      from: result.move.from,
      to: result.move.to
    };
    clearSelection();
    render();
  }

  function maybeRunComputerTurn() {
    var backend = getActiveComputerBackend();
    var requestToken;

    if (!backend || !isComputerTurn() || aiThinking) {
      return;
    }

    clearBackendError(backend);
    requestToken = aiRequestToken + 1;
    aiRequestToken = requestToken;
    aiThinking = true;
    render();

    backend.requestMove(game, {
      moveTime: currentOpponentSettings().moveTime
    }).then(function onBestMove(bestMove) {
      if (requestToken !== aiRequestToken) {
        return;
      }

      aiThinking = false;

      if (!bestMove) {
        render();
        return;
      }

      applyComputerMove(bestMove);
    }).catch(function onComputerError(error) {
      if (requestToken !== aiRequestToken) {
        return;
      }

      handleComputerFailure(backend, error);
      render();
    });
  }

  function onSquareClick(event) {
    var target = event.currentTarget;
    var x = Number(target.dataset.x);
    var y = Number(target.dataset.y);
    var piece = game.getPieceAt(x, y);
    var moveIndex;
    var chosenMove = null;
    var result;

    if (pendingPromotion) {
      return;
    }

    if (aiThinking || isComputerTurn()) {
      return;
    }

    if (game.analysis.status !== "active") {
      return;
    }

    if (selectedSquare) {
      for (moveIndex = 0; moveIndex < legalMoves.length; moveIndex += 1) {
        if (legalMoves[moveIndex].to.x === x && legalMoves[moveIndex].to.y === y) {
          chosenMove = legalMoves[moveIndex];
          break;
        }
      }

      if (chosenMove) {
        if (isPromotionMove(chosenMove)) {
          clearSelection();
          showPromotionChooser(chosenMove);
          render();
          return;
        }

        result = game.move(selectedSquare.x, selectedSquare.y, x, y);

        if (result.ok) {
          lastMove = {
            from: result.move.from,
            to: result.move.to
          };
          clearSelection();
          render();
          maybeRunComputerTurn();
          return;
        }
      }
    }

    if (piece && piece.color === game.state.turn) {
      selectedSquare = { x: x, y: y };
      legalMoves = game.getLegalMovesFrom(x, y);
    } else {
      clearSelection();
    }

    renderBoard();
  }

  function startNewGame() {
    var rules = currentRulesFromForm();

    cancelComputerTurn();
    clearComputerErrors();
    saveRules(rules);
    game.setRulesAndReset(rules);
    hidePromotionChooser();
    clearSelection();
    lastMove = null;
    showNewGameFeedback();
    render();
    maybeRunComputerTurn();
  }

  function commitPromotionChoice(pieceType) {
    var result;

    if (!pendingPromotion) {
      return;
    }

    result = game.move(
      pendingPromotion.from.x,
      pendingPromotion.from.y,
      pendingPromotion.to.x,
      pendingPromotion.to.y,
      pieceType
    );

    if (result.ok) {
      lastMove = {
        from: result.move.from,
        to: result.move.to
      };
      hidePromotionChooser();
      clearSelection();
      render();
      maybeRunComputerTurn();
    }
  }

  function cancelPromotion() {
    hidePromotionChooser();
    clearSelection();
    render();
  }

  function undoMove() {
    var shouldUndoComputerReply;

    if (pendingPromotion) {
      cancelPromotion();
      return;
    }

    cancelComputerTurn();

    if (game.undo()) {
      shouldUndoComputerReply = canUseComputerPlayer() && game.state.turn === getComputerColor();

      if (shouldUndoComputerReply) {
        game.undo();
      }

      clearSelection();
      lastMove = null;
      render();
      maybeRunComputerTurn();
    }
  }

  function onPromotionDialogCancel(event) {
    if (pendingPromotion) {
      event.preventDefault();
      cancelPromotion();
    }
  }

  function onPromotionDialogClick(event) {
    if (event.target === promotionPanel && pendingPromotion) {
      cancelPromotion();
    }
  }

  function onEngineInfoDialogClick(event) {
    if (event.target === engineInfoModal) {
      closeEngineInfo();
    }
  }

  function onEngineInfoDialogCancel() {
    closeEngineInfo();
  }

  function onVariantFormChange() {
    saveRules(currentRulesFromForm());

    if (!getSelectedComputerBackend() && currentOpponentSettings().engineId !== "auto") {
      computerEngineSelect.value = "auto";
    }

    render();
  }

  function onOpponentFormChange() {
    clearSelection();
    cancelComputerTurn();
    clearComputerErrors();
    render();
    maybeRunComputerTurn();
  }

  function initializeVariantSettings() {
    var savedRules = loadSavedRules();

    applyRulesToForm(savedRules);
    game.setRulesAndReset(savedRules);
  }

  newGameButton.addEventListener("click", startNewGame);
  undoButton.addEventListener("click", undoMove);
  opponentForm.addEventListener("change", onOpponentFormChange);
  variantForm.addEventListener("change", onVariantFormChange);
  engineInfoButton.addEventListener("click", openEngineInfo);
  engineInfoCloseButton.addEventListener("click", closeEngineInfo);
  promotionCancelButton.addEventListener("click", cancelPromotion);
  promotionButtons.forEach(function bindPromotionButton(button) {
    button.addEventListener("click", function onPromotionButtonClick() {
      commitPromotionChoice(button.dataset.piece);
    });
  });
  promotionPanel.addEventListener("cancel", onPromotionDialogCancel);
  promotionPanel.addEventListener("click", onPromotionDialogClick);
  engineInfoModal.addEventListener("cancel", onEngineInfoDialogCancel);
  engineInfoModal.addEventListener("click", onEngineInfoDialogClick);

  buildAxisLabels();
  initializeVariantSettings();
  render();
  loadVariantMlHybridEngine();
}());
