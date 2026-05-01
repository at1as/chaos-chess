(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ChessPlus = factory();
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
  var PIECE_GLYPHS = {
    w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
    b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" }
  };
  var PIECE_NAMES = {
    k: "King",
    q: "Queen",
    r: "Rook",
    b: "Bishop",
    n: "Knight",
    p: "Pawn"
  };
  var DEFAULT_RULES = {
    friendlyFire: false,
    kamikaze: false,
    wrapAround: false,
    doubleDirectionPawns: false,
    jumpPawns: false
  };
  var BACK_RANK = ["r", "n", "b", "q", "k", "b", "n", "r"];

  function normalizeRules(rules) {
    return {
      friendlyFire: Boolean(rules && rules.friendlyFire),
      kamikaze: Boolean(rules && rules.kamikaze),
      wrapAround: Boolean(rules && rules.wrapAround),
      doubleDirectionPawns: Boolean(rules && rules.doubleDirectionPawns),
      jumpPawns: Boolean(rules && rules.jumpPawns)
    };
  }

  function clonePiece(piece) {
    return piece ? { color: piece.color, type: piece.type } : null;
  }

  function createEmptyBoard() {
    return new Array(64).fill(null);
  }

  function cloneBoard(board) {
    return board.map(clonePiece);
  }

  function cloneCastlingRights(rights) {
    return {
      w: { k: Boolean(rights.w.k), q: Boolean(rights.w.q) },
      b: { k: Boolean(rights.b.k), q: Boolean(rights.b.q) }
    };
  }

  function cloneEnPassant(enPassant) {
    return enPassant ? {
      x: enPassant.x,
      y: enPassant.y,
      pawnX: enPassant.pawnX,
      pawnY: enPassant.pawnY,
      color: enPassant.color
    } : null;
  }

  function cloneState(state) {
    return {
      board: cloneBoard(state.board),
      turn: state.turn,
      rules: normalizeRules(state.rules),
      castlingRights: cloneCastlingRights(state.castlingRights),
      enPassant: cloneEnPassant(state.enPassant),
      fullmoveNumber: state.fullmoveNumber
    };
  }

  function indexFromCoord(x, y) {
    return (y * 8) + x;
  }

  function inBounds(x, y) {
    return x >= 0 && x < 8 && y >= 0 && y < 8;
  }

  function getPiece(board, x, y) {
    if (!inBounds(x, y)) {
      return null;
    }

    return board[indexFromCoord(x, y)];
  }

  function setPiece(board, x, y, piece) {
    board[indexFromCoord(x, y)] = piece;
  }

  function makePiece(color, type) {
    return { color: color, type: type };
  }

  function oppositeColor(color) {
    return color === "w" ? "b" : "w";
  }

  function coordToAlgebraic(x, y) {
    return FILES[x] + String(8 - y);
  }

  function algebraicToCoord(square) {
    if (typeof square !== "string" || square.length !== 2) {
      return null;
    }

    var file = FILES.indexOf(square[0].toLowerCase());
    var rank = Number(square[1]);

    if (file === -1 || rank < 1 || rank > 8) {
      return null;
    }

    return { x: file, y: 8 - rank };
  }

  function createInitialBoard() {
    var board = createEmptyBoard();
    var x;

    for (x = 0; x < 8; x += 1) {
      setPiece(board, x, 0, makePiece("b", BACK_RANK[x]));
      setPiece(board, x, 1, makePiece("b", "p"));
      setPiece(board, x, 6, makePiece("w", "p"));
      setPiece(board, x, 7, makePiece("w", BACK_RANK[x]));
    }

    return board;
  }

  function defaultCastlingRights() {
    return {
      w: { k: true, q: true },
      b: { k: true, q: true }
    };
  }

  function createState(rules) {
    return {
      board: createInitialBoard(),
      turn: "w",
      rules: normalizeRules(rules || DEFAULT_RULES),
      castlingRights: defaultCastlingRights(),
      enPassant: null,
      fullmoveNumber: 1
    };
  }

  function createStateFromPieces(pieces, options) {
    var board = createEmptyBoard();
    var config = options || {};
    var idx;
    var piece;
    var coord;

    for (idx = 0; idx < pieces.length; idx += 1) {
      piece = pieces[idx];
      coord = typeof piece.square === "string" ? algebraicToCoord(piece.square) : piece;

      if (!coord || !inBounds(coord.x, coord.y)) {
        throw new Error("Invalid square in createStateFromPieces");
      }

      setPiece(board, coord.x, coord.y, makePiece(piece.color, piece.type));
    }

    return {
      board: board,
      turn: config.turn || "w",
      rules: normalizeRules(config.rules || DEFAULT_RULES),
      castlingRights: config.castlingRights ? cloneCastlingRights(config.castlingRights) : defaultCastlingRights(),
      enPassant: cloneEnPassant(config.enPassant),
      fullmoveNumber: config.fullmoveNumber || 1
    };
  }

  function getPawnForwardDirections(color, rules) {
    var base = color === "w" ? -1 : 1;

    if (rules.doubleDirectionPawns) {
      return [base, -base];
    }

    return [base];
  }

  function canCaptureOccupant(mover, occupant, rules) {
    if (!occupant) {
      return false;
    }

    if (occupant.type === "k") {
      return false;
    }

    if (occupant.color !== mover.color) {
      return true;
    }

    return rules.friendlyFire;
  }

  function stepFile(x, deltaX, allowWrap) {
    var nextX = x + deltaX;

    if (nextX >= 0 && nextX < 8) {
      return { x: nextX, wrapped: false };
    }

    if (!allowWrap) {
      return null;
    }

    return {
      x: ((nextX % 8) + 8) % 8,
      wrapped: true
    };
  }

  function getPromotionRank(color) {
    return color === "w" ? 0 : 7;
  }

  function isHomeRookSquare(color, x, y) {
    return (color === "w" && y === 7 && (x === 0 || x === 7)) ||
      (color === "b" && y === 0 && (x === 0 || x === 7));
  }

  function revokeCastlingRightsForSquare(rights, color, x, y) {
    if (!isHomeRookSquare(color, x, y)) {
      return;
    }

    if (x === 0) {
      rights[color].q = false;
    }

    if (x === 7) {
      rights[color].k = false;
    }
  }

  function dedupeMoves(moves) {
    var map = new Map();
    var idx;
    var move;
    var key;
    var existing;

    for (idx = 0; idx < moves.length; idx += 1) {
      move = moves[idx];
      if (move.from && move.to) {
        key = [
          move.from.x,
          move.from.y,
          move.to.x,
          move.to.y,
          move.isCastle ? "c" : "",
          move.isEnPassant ? "e" : "",
          move.captureSquare ? coordToAlgebraic(move.captureSquare.x, move.captureSquare.y) : ""
        ].join("|");
      } else {
        key = [move.x, move.y].join("|");
      }
      existing = map.get(key);

      if (!existing || (existing.crossesWrap && !move.crossesWrap)) {
        map.set(key, move);
      }
    }

    return Array.from(map.values());
  }

  function createMoveSkeleton(piece, fromX, fromY, toX, toY) {
    return {
      piece: { color: piece.color, type: piece.type },
      from: { x: fromX, y: fromY },
      to: { x: toX, y: toY },
      capture: null,
      captureSquare: null,
      isEnPassant: false,
      isCastle: false,
      rookFrom: null,
      rookTo: null,
      promotion: null,
      isFriendlyCapture: false,
      crossesWrap: false
    };
  }

  function addOccupancyMove(moves, state, piece, fromX, fromY, toX, toY, crossesWrap) {
    var target = getPiece(state.board, toX, toY);
    var move;

    if (!target) {
      move = createMoveSkeleton(piece, fromX, fromY, toX, toY);
      move.crossesWrap = Boolean(crossesWrap);
      moves.push(move);
      return;
    }

    if (!canCaptureOccupant(piece, target, state.rules)) {
      return;
    }

    move = createMoveSkeleton(piece, fromX, fromY, toX, toY);
    move.capture = { piece: clonePiece(target), x: toX, y: toY };
    move.captureSquare = { x: toX, y: toY };
    move.isFriendlyCapture = target.color === piece.color;
    move.crossesWrap = Boolean(crossesWrap);
    moves.push(move);
  }

  function generateSlidingTargets(state, x, y, directions, mode) {
    var piece = getPiece(state.board, x, y);
    var moves = [];
    var directionIndex;
    var dir;
    var stepIndex;
    var currentX;
    var currentY;
    var fileStep;
    var nextY;
    var occupied;
    var wrappedSeen;

    if (!piece) {
      return moves;
    }

    for (directionIndex = 0; directionIndex < directions.length; directionIndex += 1) {
      dir = directions[directionIndex];
      currentX = x;
      currentY = y;
      wrappedSeen = false;

      for (stepIndex = 0; stepIndex < 7; stepIndex += 1) {
        fileStep = stepFile(currentX, dir.dx, mode.allowWrap);

        if (!fileStep) {
          break;
        }

        nextY = currentY + dir.dy;

        if (nextY < 0 || nextY > 7) {
          break;
        }

        currentX = fileStep.x;
        currentY = nextY;
        wrappedSeen = wrappedSeen || fileStep.wrapped;

        if (currentX === x && currentY === y) {
          break;
        }

        occupied = getPiece(state.board, currentX, currentY);

        if (mode.forAttack) {
          moves.push({
            x: currentX,
            y: currentY,
            crossesWrap: wrappedSeen
          });

          if (occupied) {
            break;
          }

          continue;
        }

        if (!occupied) {
          addOccupancyMove(moves, state, piece, x, y, currentX, currentY, wrappedSeen);
          continue;
        }

        addOccupancyMove(moves, state, piece, x, y, currentX, currentY, wrappedSeen);
        break;
      }
    }

    return dedupeMoves(moves);
  }

  function generateKnightTargets(state, x, y, mode) {
    var piece = getPiece(state.board, x, y);
    var moves = [];
    var offsets = [
      { dx: 1, dy: 2 }, { dx: 2, dy: 1 }, { dx: 2, dy: -1 }, { dx: 1, dy: -2 },
      { dx: -1, dy: -2 }, { dx: -2, dy: -1 }, { dx: -2, dy: 1 }, { dx: -1, dy: 2 }
    ];
    var index;
    var offset;
    var fileStep;
    var targetY;
    var target;

    if (!piece) {
      return moves;
    }

    for (index = 0; index < offsets.length; index += 1) {
      offset = offsets[index];
      targetY = y + offset.dy;

      if (targetY < 0 || targetY > 7) {
        continue;
      }

      fileStep = stepFile(x, offset.dx, mode.allowWrap);

      if (!fileStep) {
        continue;
      }

      if (mode.forAttack) {
        moves.push({
          x: fileStep.x,
          y: targetY,
          crossesWrap: fileStep.wrapped
        });
        continue;
      }

      target = getPiece(state.board, fileStep.x, targetY);

      if (!target) {
        addOccupancyMove(moves, state, piece, x, y, fileStep.x, targetY, fileStep.wrapped);
      } else if (canCaptureOccupant(piece, target, state.rules)) {
        addOccupancyMove(moves, state, piece, x, y, fileStep.x, targetY, fileStep.wrapped);
      }
    }

    return dedupeMoves(moves);
  }

  function generateKingTargets(state, x, y, mode) {
    var piece = getPiece(state.board, x, y);
    var moves = [];
    var offsets = [
      { dx: -1, dy: -1 }, { dx: 0, dy: -1 }, { dx: 1, dy: -1 },
      { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
      { dx: -1, dy: 1 }, { dx: 0, dy: 1 }, { dx: 1, dy: 1 }
    ];
    var index;
    var offset;
    var fileStep;
    var targetY;
    var target;

    if (!piece) {
      return moves;
    }

    for (index = 0; index < offsets.length; index += 1) {
      offset = offsets[index];
      targetY = y + offset.dy;

      if (targetY < 0 || targetY > 7) {
        continue;
      }

      fileStep = stepFile(x, offset.dx, mode.allowWrap);

      if (!fileStep) {
        continue;
      }

      if (mode.forAttack) {
        moves.push({
          x: fileStep.x,
          y: targetY,
          crossesWrap: fileStep.wrapped
        });
        continue;
      }

      target = getPiece(state.board, fileStep.x, targetY);

      if (!target || canCaptureOccupant(piece, target, state.rules)) {
        addOccupancyMove(moves, state, piece, x, y, fileStep.x, targetY, fileStep.wrapped);
      }
    }

    if (!mode.forAttack) {
      moves = moves.concat(generateCastlingMoves(state, piece.color));
    }

    return dedupeMoves(moves);
  }

  function generatePawnTargets(state, x, y, mode) {
    var piece = getPiece(state.board, x, y);
    var moves = [];
    var directions;
    var dirIndex;
    var dir;
    var stepLengths;
    var stepIndex;
    var distance;
    var targetY;
    var pathClear;
    var currentStepY;
    var lateralIndex;
    var lateral;
    var fileStep;
    var target;
    var move;

    if (!piece) {
      return moves;
    }

    directions = getPawnForwardDirections(piece.color, state.rules);

    if (mode.forAttack) {
      for (dirIndex = 0; dirIndex < directions.length; dirIndex += 1) {
        dir = directions[dirIndex];

        for (lateralIndex = 0; lateralIndex < 2; lateralIndex += 1) {
          lateral = lateralIndex === 0 ? -1 : 1;
          targetY = y + dir;

          if (targetY < 0 || targetY > 7) {
            continue;
          }

          fileStep = stepFile(x, lateral, mode.allowWrap);

          if (!fileStep) {
            continue;
          }

          moves.push({
            x: fileStep.x,
            y: targetY,
            crossesWrap: fileStep.wrapped
          });
        }
      }

      return dedupeMoves(moves);
    }

    stepLengths = [1, 2];

    for (dirIndex = 0; dirIndex < directions.length; dirIndex += 1) {
      dir = directions[dirIndex];

      for (stepIndex = 0; stepIndex < stepLengths.length; stepIndex += 1) {
        distance = stepLengths[stepIndex];
        targetY = y + (dir * distance);

        if (targetY < 0 || targetY > 7) {
          continue;
        }

        if (!state.rules.jumpPawns && distance === 2) {
          if (piece.color === "w" && y !== 6) {
            continue;
          }

          if (piece.color === "b" && y !== 1) {
            continue;
          }

          if (dir !== (piece.color === "w" ? -1 : 1)) {
            continue;
          }
        }

        pathClear = true;

        for (currentStepY = y + dir; currentStepY !== targetY + dir; currentStepY += dir) {
          if (getPiece(state.board, x, currentStepY)) {
            pathClear = false;
            break;
          }
        }

        if (!pathClear) {
          continue;
        }

        move = createMoveSkeleton(piece, x, y, x, targetY);

        if (targetY === getPromotionRank(piece.color)) {
          move.promotion = "q";
        }

        moves.push(move);
      }

      for (lateralIndex = 0; lateralIndex < 2; lateralIndex += 1) {
        lateral = lateralIndex === 0 ? -1 : 1;
        targetY = y + dir;

        if (targetY < 0 || targetY > 7) {
          continue;
        }

        fileStep = stepFile(x, lateral, state.rules.wrapAround);

        if (!fileStep) {
          continue;
        }

        target = getPiece(state.board, fileStep.x, targetY);

        if (target && canCaptureOccupant(piece, target, state.rules)) {
          move = createMoveSkeleton(piece, x, y, fileStep.x, targetY);
          move.capture = { piece: clonePiece(target), x: fileStep.x, y: targetY };
          move.captureSquare = { x: fileStep.x, y: targetY };
          move.isFriendlyCapture = target.color === piece.color;
          move.crossesWrap = fileStep.wrapped;

          if (targetY === getPromotionRank(piece.color)) {
            move.promotion = "q";
          }

          moves.push(move);
          continue;
        }

        if (state.enPassant &&
          state.enPassant.x === fileStep.x &&
          state.enPassant.y === targetY &&
          state.enPassant.color !== piece.color) {
          move = createMoveSkeleton(piece, x, y, fileStep.x, targetY);
          move.isEnPassant = true;
          move.captureSquare = { x: state.enPassant.pawnX, y: state.enPassant.pawnY };
          move.capture = {
            piece: clonePiece(getPiece(state.board, state.enPassant.pawnX, state.enPassant.pawnY)),
            x: state.enPassant.pawnX,
            y: state.enPassant.pawnY
          };
          move.crossesWrap = fileStep.wrapped;

          if (targetY === getPromotionRank(piece.color)) {
            move.promotion = "q";
          }

          moves.push(move);
        }
      }
    }

    return dedupeMoves(moves);
  }

  function generateCastlingMoves(state, color) {
    var moves = [];
    var homeRank = color === "w" ? 7 : 0;
    var king = getPiece(state.board, 4, homeRank);

    if (!king || king.color !== color || king.type !== "k") {
      return moves;
    }

    if (state.castlingRights[color].k &&
      canCastleSide(state, color, "k")) {
      moves.push({
        piece: { color: color, type: "k" },
        from: { x: 4, y: homeRank },
        to: { x: 6, y: homeRank },
        capture: null,
        captureSquare: null,
        isEnPassant: false,
        isCastle: true,
        rookFrom: { x: 7, y: homeRank },
        rookTo: { x: 5, y: homeRank },
        promotion: null,
        isFriendlyCapture: false,
        crossesWrap: false
      });
    }

    if (state.castlingRights[color].q &&
      canCastleSide(state, color, "q")) {
      moves.push({
        piece: { color: color, type: "k" },
        from: { x: 4, y: homeRank },
        to: { x: 2, y: homeRank },
        capture: null,
        captureSquare: null,
        isEnPassant: false,
        isCastle: true,
        rookFrom: { x: 0, y: homeRank },
        rookTo: { x: 3, y: homeRank },
        promotion: null,
        isFriendlyCapture: false,
        crossesWrap: false
      });
    }

    return moves;
  }

  function canCastleSide(state, color, side) {
    var homeRank = color === "w" ? 7 : 0;
    var rookX = side === "k" ? 7 : 0;
    var betweenSquares = side === "k" ? [5, 6] : [1, 2, 3];
    var transitSquares = side === "k" ? [4, 5, 6] : [4, 3, 2];
    var rook = getPiece(state.board, rookX, homeRank);
    var index;

    if (state.rules.kamikaze && isInCheck(state, color)) {
      return false;
    }

    if (!rook || rook.color !== color || rook.type !== "r") {
      return false;
    }

    if (isInCheck(state, color)) {
      return false;
    }

    for (index = 0; index < betweenSquares.length; index += 1) {
      if (getPiece(state.board, betweenSquares[index], homeRank)) {
        return false;
      }
    }

    for (index = 0; index < transitSquares.length; index += 1) {
      if (isSquareAttacked(state, transitSquares[index], homeRank, oppositeColor(color))) {
        return false;
      }
    }

    return true;
  }

  function generateTargets(state, x, y, options) {
    var piece = getPiece(state.board, x, y);
    var mode = {
      forAttack: Boolean(options && options.forAttack),
      allowWrap: Boolean(options && options.allowWrap)
    };

    if (!piece) {
      return [];
    }

    switch (piece.type) {
      case "p":
        return generatePawnTargets(state, x, y, mode);
      case "n":
        return generateKnightTargets(state, x, y, mode);
      case "b":
        return generateSlidingTargets(state, x, y, [
          { dx: -1, dy: -1 }, { dx: 1, dy: -1 },
          { dx: 1, dy: 1 }, { dx: -1, dy: 1 }
        ], mode);
      case "r":
        return generateSlidingTargets(state, x, y, [
          { dx: 0, dy: -1 }, { dx: 1, dy: 0 },
          { dx: 0, dy: 1 }, { dx: -1, dy: 0 }
        ], mode);
      case "q":
        return generateSlidingTargets(state, x, y, [
          { dx: -1, dy: -1 }, { dx: 0, dy: -1 }, { dx: 1, dy: -1 },
          { dx: 1, dy: 0 }, { dx: 1, dy: 1 }, { dx: 0, dy: 1 },
          { dx: -1, dy: 1 }, { dx: -1, dy: 0 }
        ], mode);
      case "k":
        return generateKingTargets(state, x, y, mode);
      default:
        return [];
    }
  }

  function isSquareAttacked(state, x, y, byColor) {
    var board = state.board;
    var boardIndex;
    var piece;
    var square;
    var attackSquares;
    var attackIndex;

    for (boardIndex = 0; boardIndex < 64; boardIndex += 1) {
      piece = board[boardIndex];

      if (!piece || piece.color !== byColor) {
        continue;
      }

      square = { x: boardIndex % 8, y: Math.floor(boardIndex / 8) };
      attackSquares = generateTargets(state, square.x, square.y, {
        forAttack: true,
        allowWrap: false
      });

      for (attackIndex = 0; attackIndex < attackSquares.length; attackIndex += 1) {
        if (attackSquares[attackIndex].x === x && attackSquares[attackIndex].y === y) {
          return true;
        }
      }
    }

    return false;
  }

  function findKing(board, color) {
    var idx;
    var piece;

    for (idx = 0; idx < 64; idx += 1) {
      piece = board[idx];

      if (piece && piece.color === color && piece.type === "k") {
        return {
          x: idx % 8,
          y: Math.floor(idx / 8)
        };
      }
    }

    return null;
  }

  function isInCheck(state, color) {
    var kingSquare = findKing(state.board, color);

    if (!kingSquare) {
      return true;
    }

    return isSquareAttacked(state, kingSquare.x, kingSquare.y, oppositeColor(color));
  }

  function applyMove(state, move, promotionChoice) {
    var next = cloneState(state);
    var movingPiece = clonePiece(getPiece(next.board, move.from.x, move.from.y));
    var capturedPiece = null;
    var appliedPromotion = promotionChoice || move.promotion || null;
    var twoStep = false;

    if (!movingPiece) {
      throw new Error("Cannot apply move without a piece on the source square.");
    }

    next.enPassant = null;

    if (movingPiece.type === "k") {
      next.castlingRights[movingPiece.color].k = false;
      next.castlingRights[movingPiece.color].q = false;
    }

    if (movingPiece.type === "r") {
      revokeCastlingRightsForSquare(next.castlingRights, movingPiece.color, move.from.x, move.from.y);
    }

    setPiece(next.board, move.from.x, move.from.y, null);

    if (move.isEnPassant && move.captureSquare) {
      capturedPiece = clonePiece(getPiece(next.board, move.captureSquare.x, move.captureSquare.y));
      setPiece(next.board, move.captureSquare.x, move.captureSquare.y, null);
    } else if (move.captureSquare) {
      capturedPiece = clonePiece(getPiece(next.board, move.captureSquare.x, move.captureSquare.y));
      setPiece(next.board, move.captureSquare.x, move.captureSquare.y, null);
    }

    if (capturedPiece && capturedPiece.type === "r") {
      revokeCastlingRightsForSquare(next.castlingRights, capturedPiece.color, move.captureSquare.x, move.captureSquare.y);
    }

    if (move.isCastle) {
      setPiece(next.board, move.rookFrom.x, move.rookFrom.y, null);
      setPiece(next.board, move.rookTo.x, move.rookTo.y, makePiece(movingPiece.color, "r"));
      setPiece(next.board, move.to.x, move.to.y, movingPiece);
    } else if (state.rules.kamikaze && capturedPiece) {
      setPiece(next.board, move.to.x, move.to.y, null);
    } else {
      if (appliedPromotion && movingPiece.type === "p" && move.to.y === getPromotionRank(movingPiece.color)) {
        movingPiece.type = appliedPromotion;
      }

      setPiece(next.board, move.to.x, move.to.y, movingPiece);
    }

    twoStep = movingPiece.type === "p" &&
      move.from.x === move.to.x &&
      Math.abs(move.from.y - move.to.y) === 2 &&
      !capturedPiece;

    if (twoStep) {
      next.enPassant = {
        x: move.to.x,
        y: (move.from.y + move.to.y) / 2,
        pawnX: move.to.x,
        pawnY: move.to.y,
        color: movingPiece.color
      };
    }

    next.turn = oppositeColor(state.turn);

    if (state.turn === "b") {
      next.fullmoveNumber += 1;
    }

    return next;
  }

  function getPseudoMoves(state, x, y) {
    var piece = getPiece(state.board, x, y);

    if (!piece || piece.color !== state.turn) {
      return [];
    }

    return generateTargets(state, x, y, {
      forAttack: false,
      allowWrap: state.rules.wrapAround
    });
  }

  function isMoveLegal(state, move, promotionChoice) {
    var next = applyMove(state, move, promotionChoice);
    return !isInCheck(next, move.piece.color);
  }

  function getLegalMoves(state, x, y, promotionChoice) {
    var moves = getPseudoMoves(state, x, y);
    var legal = [];
    var idx;

    for (idx = 0; idx < moves.length; idx += 1) {
      if (isMoveLegal(state, moves[idx], promotionChoice)) {
        legal.push(moves[idx]);
      }
    }

    return legal;
  }

  function getAllLegalMoves(state, color, promotionChoice) {
    var activeColor = color || state.turn;
    var boardIndex;
    var piece;
    var allMoves = [];
    var current;

    for (boardIndex = 0; boardIndex < 64; boardIndex += 1) {
      piece = state.board[boardIndex];

      if (!piece || piece.color !== activeColor) {
        continue;
      }

      current = getLegalMoves(state, boardIndex % 8, Math.floor(boardIndex / 8), promotionChoice);
      allMoves = allMoves.concat(current);
    }

    return allMoves;
  }

  function analyzeState(state, promotionChoice) {
    var whiteKing = findKing(state.board, "w");
    var blackKing = findKing(state.board, "b");
    var inCheck = isInCheck(state, state.turn);
    var legalMoves = getAllLegalMoves(state, state.turn, promotionChoice);
    var result = {
      turn: state.turn,
      status: "active",
      winner: null,
      inCheck: inCheck,
      legalMoves: legalMoves,
      reason: ""
    };

    if (!whiteKing || !blackKing) {
      result.status = "invalid";
      result.reason = "Both kings must exist on the board.";
      return result;
    }

    if (legalMoves.length === 0) {
      if (inCheck) {
        result.status = "checkmate";
        result.winner = oppositeColor(state.turn);
        result.reason = "No legal replies remain.";
      } else {
        result.status = "stalemate";
        result.reason = "No legal moves remain.";
      }
    } else if (inCheck) {
      result.reason = "Check.";
    }

    return result;
  }

  function moveDescriptor(move, rules, promotionChoice) {
    var tags = [];
    var pieceLetter = move.piece.type === "p" ? "P" : move.piece.type.toUpperCase();
    var action = move.capture ? "x" : "-";
    var text;

    if (move.isCastle) {
      text = move.to.x === 6 ? "O-O" : "O-O-O";
    } else {
      text = pieceLetter + " " + coordToAlgebraic(move.from.x, move.from.y) +
        action + coordToAlgebraic(move.to.x, move.to.y);
    }

    if (move.isEnPassant) {
      tags.push("en passant");
    }

    if (move.isFriendlyCapture) {
      tags.push("friendly fire");
    }

    if (move.crossesWrap) {
      tags.push("wrap");
    }

    if (rules.kamikaze && move.capture) {
      tags.push("boom");
    }

    if ((promotionChoice || move.promotion) && move.piece.type === "p" && move.to.y === getPromotionRank(move.piece.color)) {
      tags.push("=" + (promotionChoice || move.promotion).toUpperCase());
    }

    return tags.length ? text + " [" + tags.join(", ") + "]" : text;
  }

  function rulesSummary(rules) {
    var active = [];

    if (rules.friendlyFire) {
      active.push("Friendly Fire");
    }

    if (rules.kamikaze) {
      active.push("Kamikaze");
    }

    if (rules.wrapAround) {
      active.push("Wrap Around");
    }

    if (rules.doubleDirectionPawns) {
      active.push("Double-Direction Pawns");
    }

    if (rules.jumpPawns) {
      active.push("Jump Pawns");
    }

    return active.length ? active.join(" • ") : "Classic rules";
  }

  function ChessGame(rules) {
    this.reset(rules || DEFAULT_RULES);
  }

  ChessGame.prototype.reset = function reset(rules) {
    this.state = createState(rules || DEFAULT_RULES);
    this.history = [];
    this.moveHistory = [];
    this.analysis = analyzeState(this.state);
  };

  ChessGame.prototype.getPieceAt = function getPieceAt(x, y) {
    return getPiece(this.state.board, x, y);
  };

  ChessGame.prototype.getLegalMovesFrom = function getLegalMovesFrom(x, y, promotionChoice) {
    return getLegalMoves(this.state, x, y, promotionChoice);
  };

  ChessGame.prototype.getAllLegalMoves = function getAllLegalMovesOnGame(promotionChoice) {
    return getAllLegalMoves(this.state, this.state.turn, promotionChoice);
  };

  ChessGame.prototype.move = function makeMove(fromX, fromY, toX, toY, promotionChoice) {
    var legalMoves = this.getLegalMovesFrom(fromX, fromY, promotionChoice);
    var idx;
    var move = null;
    var snapshot;
    var notation;

    for (idx = 0; idx < legalMoves.length; idx += 1) {
      if (legalMoves[idx].to.x === toX && legalMoves[idx].to.y === toY) {
        move = legalMoves[idx];
        break;
      }
    }

    if (!move) {
      return { ok: false, error: "Illegal move." };
    }

    snapshot = {
      state: cloneState(this.state),
      analysis: {
        turn: this.analysis.turn,
        status: this.analysis.status,
        winner: this.analysis.winner,
        inCheck: this.analysis.inCheck,
        reason: this.analysis.reason
      },
      moveHistory: this.moveHistory.slice()
    };
    notation = moveDescriptor(move, this.state.rules, promotionChoice);

    this.history.push(snapshot);
    this.state = applyMove(this.state, move, promotionChoice);
    this.moveHistory.push(notation);
    this.analysis = analyzeState(this.state, promotionChoice);

    return {
      ok: true,
      move: move,
      notation: notation,
      analysis: this.analysis
    };
  };

  ChessGame.prototype.undo = function undo() {
    var snapshot = this.history.pop();

    if (!snapshot) {
      return false;
    }

    this.state = snapshot.state;
    this.analysis = snapshot.analysis;
    this.moveHistory = snapshot.moveHistory;
    return true;
  };

  ChessGame.prototype.setRulesAndReset = function setRulesAndReset(rules) {
    this.reset(rules);
  };

  return {
    ChessGame: ChessGame,
    DEFAULT_RULES: DEFAULT_RULES,
    FILES: FILES,
    PIECE_GLYPHS: PIECE_GLYPHS,
    PIECE_NAMES: PIECE_NAMES,
    normalizeRules: normalizeRules,
    createState: createState,
    createStateFromPieces: createStateFromPieces,
    createEmptyBoard: createEmptyBoard,
    coordToAlgebraic: coordToAlgebraic,
    algebraicToCoord: algebraicToCoord,
    getLegalMoves: getLegalMoves,
    getAllLegalMoves: getAllLegalMoves,
    analyzeState: analyzeState,
    applyMove: applyMove,
    isSquareAttacked: isSquareAttacked,
    isInCheck: isInCheck,
    moveDescriptor: moveDescriptor,
    rulesSummary: rulesSummary
  };
}));
