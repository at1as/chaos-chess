(function () {
  "use strict";

  var engine = window.ChessPlus;
  var boardElement = document.getElementById("board");
  var statusText = document.getElementById("status-text");
  var variantSummary = document.getElementById("variant-summary");
  var moveLog = document.getElementById("move-log");
  var opponentForm = document.getElementById("opponent-form");
  var computerModeInput = opponentForm.querySelector('input[name="opponentMode"][value="computer"]');
  var variantForm = document.getElementById("variant-form");
  var computerSideSelect = document.getElementById("computer-side-select");
  var computerLevelSelect = document.getElementById("computer-level-select");
  var computerDisclaimer = document.getElementById("computer-disclaimer");
  var newGameButton = document.getElementById("new-game-button");
  var undoButton = document.getElementById("undo-button");
  var promotionPanel = document.getElementById("promotion-panel");
  var promotionText = document.getElementById("promotion-text");
  var promotionCancelButton = document.getElementById("promotion-cancel-button");
  var promotionButtons = Array.prototype.slice.call(document.querySelectorAll(".promotion-option"));
  var VARIANT_SETTINGS_STORAGE_KEY = "chaos-chess.variant-settings";
  var classicEngine = typeof window.Worker === "function" &&
    window.ChessPlusAI &&
    window.ChessPlusAI.ClassicEngine
    ? new window.ChessPlusAI.ClassicEngine({
      workerUrl: "./vendor/stockfish/stockfish-18-lite-single.js"
    })
    : null;
  var selectedSquare = null;
  var legalMoves = [];
  var lastMove = null;
  var pendingPromotion = null;
  var aiThinking = false;
  var aiRequestToken = 0;
  var computerUnavailableReason = null;
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
      moveTime: Number(computerLevelSelect.value) || 600
    };
  }

  function isClassicVariantSelection() {
    return engine.isClassicRules(currentRulesFromForm());
  }

  function setOpponentMode(mode) {
    var normalizedMode = mode === "computer" ? "computer" : "human";

    Array.prototype.forEach.call(opponentForm.elements.opponentMode, function setRadioState(input) {
      input.checked = input.value === normalizedMode;
    });
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
    var turnName = game.state.turn === "w" ? "White" : "Black";

    if (pendingPromotion) {
      statusText.textContent = (pendingPromotion.color === "w" ? "White" : "Black") + " must choose a promotion piece.";
    } else if (aiThinking) {
      statusText.textContent = turnName + " computer is thinking.";
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

    variantSummary.textContent = opponentSummaryText() + " • " + engine.rulesSummary(game.state.rules);
    undoButton.disabled = !pendingPromotion && game.history.length === 0;
  }

  function isComputerModeEnabled() {
    return currentOpponentSettings().mode === "computer";
  }

  function getComputerColor() {
    return currentOpponentSettings().side;
  }

  function canUseComputerPlayer() {
    return Boolean(classicEngine) &&
      !computerUnavailableReason &&
      isComputerModeEnabled() &&
      engine.isClassicRules(game.state.rules);
  }

  function opponentSummaryText() {
    var settings = currentOpponentSettings();

    if (settings.mode !== "computer") {
      return "Human vs Human";
    }

    if (!classicEngine) {
      return "Computer Unavailable";
    }

    if (!engine.isClassicRules(game.state.rules)) {
      return "Computer Selected (Classic Only)";
    }

    return "Vs Computer (" + (settings.side === "w" ? "White" : "Black") + ")";
  }

  function isComputerTurn() {
    return canUseComputerPlayer() &&
      !pendingPromotion &&
      game.analysis.status === "active" &&
      game.state.turn === getComputerColor();
  }

  function updateOpponentUI() {
    var settings = currentOpponentSettings();
    var engineSupported = Boolean(classicEngine);
    var classicSelection = isClassicVariantSelection();
    var controlsEnabled = engineSupported && classicSelection && settings.mode === "computer";

    computerModeInput.disabled = !engineSupported || !classicSelection;
    computerSideSelect.disabled = !controlsEnabled;
    computerLevelSelect.disabled = !controlsEnabled;

    if (!engineSupported) {
      computerDisclaimer.textContent = "Computer play is unavailable in this browser.";
      return;
    }

    if (!classicSelection) {
      computerDisclaimer.textContent = "Variant rules are selected. Computer play is disabled until you switch back to classic rules.";
      return;
    }

    if (computerUnavailableReason) {
      computerDisclaimer.textContent = computerUnavailableReason;
      return;
    }

    if (settings.mode !== "computer") {
      computerDisclaimer.textContent = "Computer play uses Stockfish and is limited to classic chess in this build.";
      return;
    }

    if (!engine.isClassicRules(game.state.rules)) {
      computerDisclaimer.textContent = "The current game uses variant rules. Start a new classic game to enable computer play.";
      return;
    }

    if (aiThinking) {
      computerDisclaimer.textContent = "Computer is thinking.";
      return;
    }

    if (game.analysis.status !== "active") {
      computerDisclaimer.textContent = "Start a new classic game to play against the computer.";
      return;
    }

    computerDisclaimer.textContent = "Computer is playing " + (settings.side === "w" ? "White" : "Black") + " with Stockfish.";
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

    if (classicEngine && classicEngine.worker) {
      classicEngine.reset();
    }
  }

  function parseUciMove(uci) {
    var from;
    var to;

    if (!uci || uci === "(none)" || uci.length < 4) {
      return null;
    }

    from = engine.algebraicToCoord(uci.slice(0, 2));
    to = engine.algebraicToCoord(uci.slice(2, 4));

    if (!from || !to) {
      return null;
    }

    return {
      from: from,
      to: to,
      promotion: uci.length > 4 ? uci.slice(4, 5).toLowerCase() : null
    };
  }

  function getComputerFailureMessage() {
    if (window.location.protocol === "file:") {
      return "Computer play needs the app to be served over http:// or https://. Use make serve to enable it locally.";
    }

    return "Computer play could not start. Continue locally or start a new classic game to retry.";
  }

  function handleComputerFailure(error) {
    if (window.console && typeof window.console.error === "function") {
      window.console.error(error);
    }

    computerUnavailableReason = getComputerFailureMessage();
    aiThinking = false;

    if (classicEngine && classicEngine.worker) {
      classicEngine.reset();
    }
  }

  function applyComputerMoveFromUci(uci) {
    var parsedMove = parseUciMove(uci);
    var result;

    if (!parsedMove) {
      throw new Error("Stockfish returned an invalid move.");
    }

    result = game.move(
      parsedMove.from.x,
      parsedMove.from.y,
      parsedMove.to.x,
      parsedMove.to.y,
      parsedMove.promotion
    );

    if (!result.ok) {
      throw new Error("Stockfish returned an illegal move.");
    }

    lastMove = {
      from: result.move.from,
      to: result.move.to
    };
    clearSelection();
    render();
  }

  function maybeRunComputerTurn() {
    var requestToken;

    if (!isComputerTurn() || aiThinking) {
      return;
    }

    requestToken = aiRequestToken + 1;
    aiRequestToken = requestToken;
    aiThinking = true;
    render();

    classicEngine.requestBestMove(game.getUciMoves(), {
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

      applyComputerMoveFromUci(bestMove);
    }).catch(function onComputerError(error) {
      if (requestToken !== aiRequestToken) {
        return;
      }

      handleComputerFailure(error);
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
    computerUnavailableReason = null;
    saveRules(rules);
    game.setRulesAndReset(rules);
    hidePromotionChooser();
    clearSelection();
    lastMove = null;
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

  function onVariantFormChange() {
    var wasComputerMode = isComputerModeEnabled();

    saveRules(currentRulesFromForm());

    if (!isClassicVariantSelection()) {
      setOpponentMode("human");

      if (wasComputerMode || aiThinking) {
        cancelComputerTurn();
      }
    }

    render();
  }

  function onOpponentFormChange() {
    clearSelection();
    cancelComputerTurn();
    computerUnavailableReason = null;
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
  promotionCancelButton.addEventListener("click", cancelPromotion);
  promotionButtons.forEach(function bindPromotionButton(button) {
    button.addEventListener("click", function onPromotionButtonClick() {
      commitPromotionChoice(button.dataset.piece);
    });
  });
  promotionPanel.addEventListener("cancel", onPromotionDialogCancel);
  promotionPanel.addEventListener("click", onPromotionDialogClick);

  buildAxisLabels();
  initializeVariantSettings();
  render();
}());
