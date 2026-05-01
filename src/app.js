(function () {
  "use strict";

  var engine = window.ChessPlus;
  var boardElement = document.getElementById("board");
  var statusText = document.getElementById("status-text");
  var variantSummary = document.getElementById("variant-summary");
  var moveLog = document.getElementById("move-log");
  var variantForm = document.getElementById("variant-form");
  var newGameButton = document.getElementById("new-game-button");
  var undoButton = document.getElementById("undo-button");
  var promotionPanel = document.getElementById("promotion-panel");
  var promotionText = document.getElementById("promotion-text");
  var promotionCancelButton = document.getElementById("promotion-cancel-button");
  var promotionButtons = Array.prototype.slice.call(document.querySelectorAll(".promotion-option"));
  var VARIANT_SETTINGS_STORAGE_KEY = "chaos-chess.variant-settings";
  var selectedSquare = null;
  var legalMoves = [];
  var lastMove = null;
  var pendingPromotion = null;
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

    variantSummary.textContent = engine.rulesSummary(game.state.rules);
    undoButton.disabled = game.history.length === 0;
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
    renderStatus();
    renderMoveLog();
    renderBoard();
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

    saveRules(rules);
    game.setRulesAndReset(rules);
    hidePromotionChooser();
    clearSelection();
    lastMove = null;
    render();
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
    }
  }

  function cancelPromotion() {
    hidePromotionChooser();
    clearSelection();
    render();
  }

  function undoMove() {
    if (pendingPromotion) {
      cancelPromotion();
      return;
    }

    if (game.undo()) {
      clearSelection();
      lastMove = null;
      render();
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
    saveRules(currentRulesFromForm());
  }

  function initializeVariantSettings() {
    var savedRules = loadSavedRules();

    applyRulesToForm(savedRules);
    game.setRulesAndReset(savedRules);
  }

  newGameButton.addEventListener("click", startNewGame);
  undoButton.addEventListener("click", undoMove);
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
