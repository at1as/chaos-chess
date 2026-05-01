(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("./engine.js"),
      require("./position-encoder.js")
    );
  } else {
    root.ChessPlusComputer = factory(root.ChessPlus, root.ChessPlusFeatures);
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function (engine, features) {
  "use strict";

  var PIECE_VALUES = {
    p: 100,
    n: 320,
    b: 330,
    r: 500,
    q: 900,
    k: 0
  };
  var PROMOTION_CHOICES = ["q", "r", "b", "n"];
  var WIN_SCORE = 1000000;
  var SEARCH_TIMEOUT_CODE = "SEARCH_TIMEOUT";
  var DEFAULT_MODEL_SEARCH_SCALE = 600;
  var DEFAULT_MODEL_BLEND = 1;

  function oppositeColor(color) {
    return color === "w" ? "b" : "w";
  }

  function nowMs() {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      return performance.now();
    }

    return Date.now();
  }

  function stateForTurn(state, color) {
    return {
      board: state.board,
      turn: color,
      rules: state.rules,
      castlingRights: state.castlingRights,
      enPassant: state.enPassant,
      fullmoveNumber: state.fullmoveNumber
    };
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

  function isPromotionMove(move) {
    return Boolean(
      move &&
      move.piece &&
      move.piece.type === "p" &&
      (move.to.y === 0 || move.to.y === 7)
    );
  }

  function expandMoveCandidates(state) {
    var legalMoves = engine.getAllLegalMoves(state);
    var candidates = [];
    var moveIndex;
    var promotionIndex;

    for (moveIndex = 0; moveIndex < legalMoves.length; moveIndex += 1) {
      if (isPromotionMove(legalMoves[moveIndex])) {
        for (promotionIndex = 0; promotionIndex < PROMOTION_CHOICES.length; promotionIndex += 1) {
          candidates.push({
            move: legalMoves[moveIndex],
            promotion: PROMOTION_CHOICES[promotionIndex]
          });
        }

        continue;
      }

      candidates.push({
        move: legalMoves[moveIndex],
        promotion: null
      });
    }

    return candidates;
  }

  function centralityBonus(x, y) {
    var dx = Math.abs(3.5 - x);
    var dy = Math.abs(3.5 - y);
    return Math.round((7 - (dx + dy)) * 4);
  }

  function pawnProgressBonus(piece, y) {
    var progress = piece.color === "w" ? 6 - y : y - 1;

    if (progress < 0) {
      return 0;
    }

    return progress * 9;
  }

  function getPieceValue(type, rules) {
    var value = PIECE_VALUES[type];

    if (!rules) {
      return value;
    }

    if (rules.kamikaze) {
      switch (type) {
        case "q":
          value = 760;
          break;
        case "r":
          value = 430;
          break;
        case "b":
        case "n":
          value = 300;
          break;
        case "p":
          value = 92;
          break;
        default:
          break;
      }
    }

    if (type === "p" && (rules.doubleDirectionPawns || rules.jumpPawns)) {
      value += 14;
    }

    if (type === "n" && rules.wrapAround) {
      value += 10;
    }

    return value;
  }

  function pieceSquareBonus(piece, x, y) {
    switch (piece.type) {
      case "p":
        return pawnProgressBonus(piece, y);
      case "n":
      case "b":
        return centralityBonus(x, y);
      case "q":
        return Math.round(centralityBonus(x, y) * 0.6);
      case "r":
        return Math.round((7 - Math.abs(3.5 - x)) * 3);
      default:
        return 0;
    }
  }

  function scoreBoard(board, perspectiveColor) {
    var score = 0;
    var index;
    var piece;
    var sign;
    var x;
    var y;
    var rules = null;

    for (index = 0; index < board.length; index += 1) {
      piece = board[index];

      if (!piece) {
        continue;
      }

      sign = piece.color === perspectiveColor ? 1 : -1;
      x = index % 8;
      y = Math.floor(index / 8);

      score += sign * getPieceValue(piece.type, rules);
      score += sign * pieceSquareBonus(piece, x, y);
    }

    return score;
  }

  function scoreBoardWithRules(state, perspectiveColor) {
    var score = 0;
    var index;
    var piece;
    var sign;
    var x;
    var y;
    var rules = state.rules;

    for (index = 0; index < state.board.length; index += 1) {
      piece = state.board[index];

      if (!piece) {
        continue;
      }

      sign = piece.color === perspectiveColor ? 1 : -1;
      x = index % 8;
      y = Math.floor(index / 8);

      score += sign * getPieceValue(piece.type, rules);
      score += sign * pieceSquareBonus(piece, x, y);
    }

    return score;
  }

  function scoreCastlingRights(state, perspectiveColor) {
    var ownRights = state.castlingRights[perspectiveColor];
    var enemyRights = state.castlingRights[oppositeColor(perspectiveColor)];

    return (
      (ownRights.k ? 12 : 0) +
      (ownRights.q ? 8 : 0) -
      (enemyRights.k ? 12 : 0) -
      (enemyRights.q ? 8 : 0)
    );
  }

  function evaluateTerminalState(state, perspectiveColor, analysis) {
    var nextAnalysis = analysis || engine.analyzeState(state);

    if (nextAnalysis.status === "checkmate") {
      return nextAnalysis.winner === perspectiveColor ? WIN_SCORE : -WIN_SCORE;
    }

    if (nextAnalysis.status === "stalemate") {
      return 0;
    }

    if (nextAnalysis.status === "invalid") {
      return state.turn === perspectiveColor ? -WIN_SCORE : WIN_SCORE;
    }

    return null;
  }

  function scoreHeuristicState(state, perspectiveColor, analysis) {
    var nextAnalysis = analysis || engine.analyzeState(state);
    var score;

    score = scoreBoardWithRules(state, perspectiveColor);
    score += scoreCastlingRights(state, perspectiveColor);
    score += (nextAnalysis.legalMoves ? nextAnalysis.legalMoves.length : 0) *
      (nextAnalysis.turn === perspectiveColor ? 2 : -2);

    if (nextAnalysis.inCheck) {
      score += nextAnalysis.turn === perspectiveColor ? -55 : 55;
    }

    return score;
  }

  function evaluateState(state, perspectiveColor, analysis) {
    var terminalScore = evaluateTerminalState(state, perspectiveColor, analysis);

    if (terminalScore !== null) {
      return terminalScore;
    }

    return scoreHeuristicState(state, perspectiveColor, analysis);
  }

  function clampPrediction(value) {
    if (value > 0.995) {
      return 0.995;
    }

    if (value < -0.995) {
      return -0.995;
    }

    return value;
  }

  function atanh(value) {
    return 0.5 * Math.log((1 + value) / (1 - value));
  }

  function normalizeValueModelSpec(modelSpec) {
    if (!modelSpec) {
      return null;
    }

    if (modelSpec.model) {
      return modelSpec.model;
    }

    return modelSpec;
  }

  function evaluateLinearModel(modelSpec, vector) {
    var total = Number(modelSpec.bias) || 0;
    var weights = modelSpec.weights || [];
    var index;

    for (index = 0; index < vector.length && index < weights.length; index += 1) {
      total += Number(weights[index]) * vector[index];
    }

    return total;
  }

  function evaluateMlpModel(modelSpec, vector) {
    var hiddenWeights = modelSpec.hiddenWeights || [];
    var hiddenBiases = modelSpec.hiddenBiases || [];
    var outputWeights = modelSpec.outputWeights || [];
    var outputBias = Number(modelSpec.outputBias) || 0;
    var hiddenValues = [];
    var hiddenIndex;
    var inputIndex;
    var total;

    for (hiddenIndex = 0; hiddenIndex < hiddenWeights.length; hiddenIndex += 1) {
      total = Number(hiddenBiases[hiddenIndex]) || 0;

      for (inputIndex = 0; inputIndex < vector.length && inputIndex < hiddenWeights[hiddenIndex].length; inputIndex += 1) {
        total += Number(hiddenWeights[hiddenIndex][inputIndex]) * vector[inputIndex];
      }

      hiddenValues.push(Math.tanh(total));
    }

    total = outputBias;

    for (hiddenIndex = 0; hiddenIndex < hiddenValues.length && hiddenIndex < outputWeights.length; hiddenIndex += 1) {
      total += Number(outputWeights[hiddenIndex]) * hiddenValues[hiddenIndex];
    }

    return total;
  }

  function createValueModelEvaluator(modelSpec, options) {
    var normalizedModel = normalizeValueModelSpec(modelSpec);
    var config = options || {};
    var scoreScale = Number(config.scoreScale) || DEFAULT_MODEL_SEARCH_SCALE;
    var featureEncoding = config.featureEncoding ||
      (modelSpec && modelSpec.trainingConfig && modelSpec.trainingConfig.featureEncoding) ||
      modelSpec.featureEncoding ||
      "absolute";
    var encoder = null;

    if (!normalizedModel) {
      return null;
    }

    if (features) {
      if (featureEncoding === "canonical" &&
        typeof features.encodeCanonicalStateVector === "function") {
        encoder = features.encodeCanonicalStateVector;
      } else if (typeof features.encodeStateVector === "function") {
        encoder = features.encodeStateVector;
      }
    }

    if (!encoder) {
      throw new Error("Position encoder is unavailable for value-model evaluation.");
    }

    return function evaluateValueModel(state, perspectiveColor) {
      var vector = encoder(state);
      var prediction;
      var engineScore;

      if (normalizedModel.modelType === "linear") {
        prediction = evaluateLinearModel(normalizedModel, vector);
      } else if (normalizedModel.modelType === "mlp") {
        prediction = evaluateMlpModel(normalizedModel, vector);
      } else {
        throw new Error("Unsupported value model type: " + normalizedModel.modelType);
      }

      engineScore = atanh(clampPrediction(prediction)) * scoreScale;

      if (state.turn !== perspectiveColor) {
        engineScore *= -1;
      }

      return engineScore;
    };
  }

  function resolveLeafEvaluator(options) {
    if (options && typeof options.leafEvaluator === "function") {
      return options.leafEvaluator;
    }

    if (options && options.valueModel) {
      return createValueModelEvaluator(options.valueModel, options);
    }

    return null;
  }

  function resolveOrderingEvaluator(options) {
    if (options && typeof options.orderingEvaluator === "function") {
      return options.orderingEvaluator;
    }

    if (options && options.orderingValueModel) {
      return createValueModelEvaluator(options.orderingValueModel, options);
    }

    return null;
  }

  function moveBonus(move, promotionChoice, nextAnalysis, rules) {
    var bonus = 0;
    var moverValue = getPieceValue(move.piece.type, rules);

    if (move.capture) {
      bonus += Math.round(getPieceValue(move.capture.piece.type, rules) * 0.18);

      if (move.isFriendlyCapture) {
        bonus -= Math.round(getPieceValue(move.capture.piece.type, rules) * 0.22);
      } else if (rules && rules.kamikaze) {
        bonus += Math.round((getPieceValue(move.capture.piece.type, rules) - moverValue) * 0.12);
      }
    }

    if (move.isCastle) {
      bonus += 35;
    }

    if (move.crossesWrap) {
      bonus += 8;
    }

    if (promotionChoice) {
      bonus += Math.round(getPieceValue(promotionChoice, rules) * 0.14);
    }

    if (nextAnalysis.inCheck) {
      bonus += 18;
    }

    return bonus;
  }

  function compareCandidateMoves(left, right) {
    var leftText = engine.moveDescriptor(left.move, left.rules, left.promotion);
    var rightText = engine.moveDescriptor(right.move, right.rules, right.promotion);

    if (leftText < rightText) {
      return -1;
    }

    if (leftText > rightText) {
      return 1;
    }

    return 0;
  }

  function chooseHeuristicMove(state, options) {
    var candidates = expandMoveCandidates(state);
    var perspectiveColor = state.turn;
    var bestCandidate = null;
    var bestScore = -Infinity;
    var index;
    var nextState;
    var nextAnalysis;
    var score;

    if (candidates.length === 0) {
      return null;
    }

    for (index = 0; index < candidates.length; index += 1) {
      nextState = engine.applyMove(state, candidates[index].move, candidates[index].promotion);
      nextAnalysis = engine.analyzeState(nextState);
      score = evaluateState(nextState, perspectiveColor, nextAnalysis, 1);
      score += moveBonus(candidates[index].move, candidates[index].promotion, nextAnalysis, state.rules);

      if (!bestCandidate || score > bestScore) {
        bestCandidate = candidates[index];
        bestScore = score;
        continue;
      }

      if (score === bestScore &&
        compareCandidateMoves(
          { move: candidates[index].move, promotion: candidates[index].promotion, rules: state.rules },
          { move: bestCandidate.move, promotion: bestCandidate.promotion, rules: state.rules }
        ) < 0) {
        bestCandidate = candidates[index];
      }
    }

    return {
      from: { x: bestCandidate.move.from.x, y: bestCandidate.move.from.y },
      to: { x: bestCandidate.move.to.x, y: bestCandidate.move.to.y },
      promotion: bestCandidate.promotion
    };
  }

  function candidateEquals(left, right) {
    return Boolean(
      left &&
      right &&
      left.move.from.x === right.move.from.x &&
      left.move.from.y === right.move.from.y &&
      left.move.to.x === right.move.to.x &&
      left.move.to.y === right.move.to.y &&
      left.promotion === right.promotion
    );
  }

  function pieceKey(piece) {
    if (!piece) {
      return ".";
    }

    return piece.color === "w" ? piece.type.toUpperCase() : piece.type;
  }

  function stateKey(state) {
    var boardKey = "";
    var index;
    var rules = state.rules;

    for (index = 0; index < state.board.length; index += 1) {
      boardKey += pieceKey(state.board[index]);
    }

    return [
      state.turn,
      state.castlingRights.w.k ? "1" : "0",
      state.castlingRights.w.q ? "1" : "0",
      state.castlingRights.b.k ? "1" : "0",
      state.castlingRights.b.q ? "1" : "0",
      state.enPassant ? engine.coordToAlgebraic(state.enPassant.x, state.enPassant.y) : "-",
      rules.friendlyFire ? "1" : "0",
      rules.kamikaze ? "1" : "0",
      rules.wrapAround ? "1" : "0",
      rules.doubleDirectionPawns ? "1" : "0",
      rules.jumpPawns ? "1" : "0",
      boardKey
    ].join("|");
  }

  function createSearchTimeoutError() {
    var error = new Error("Search timed out.");

    error.code = SEARCH_TIMEOUT_CODE;
    return error;
  }

  function isSearchTimeout(error) {
    return Boolean(error && error.code === SEARCH_TIMEOUT_CODE);
  }

  function checkSearchBudget(context) {
    context.nodes += 1;

    if (context.deadlineMs &&
      (context.nodes & 127) === 0 &&
      nowMs() >= context.deadlineMs) {
      throw createSearchTimeoutError();
    }
  }

  function orderingScore(candidate, rules, preferredCandidate) {
    var score = 0;
    var moverValue = getPieceValue(candidate.move.piece.type, rules);

    if (preferredCandidate && candidateEquals(candidate, preferredCandidate)) {
      score += 500000;
    }

    if (candidate.move.capture) {
      score += 2500 + (getPieceValue(candidate.move.capture.piece.type, rules) * 12) - moverValue;

      if (candidate.move.isFriendlyCapture) {
        score -= 3200 + (getPieceValue(candidate.move.capture.piece.type, rules) * 6);
      } else if (rules.kamikaze) {
        score += getPieceValue(candidate.move.capture.piece.type, rules) - moverValue;
      }
    }

    if (candidate.promotion) {
      score += 1800 + getPieceValue(candidate.promotion, rules);
    }

    if (candidate.move.isCastle) {
      score += 420;
    }

    if (candidate.move.crossesWrap) {
      score += 45;
    }

    return score;
  }

  function orderCandidates(state, candidates, preferredCandidate, context) {
    var rules = state.rules;
    var maximizing = !context || state.turn === context.rootColor;
    var orderingWeight = context ? context.orderingWeight : 0;
    var scoredCandidates = candidates.map(function scoreCandidate(candidate) {
      var score = orderingScore(candidate, rules, preferredCandidate);
      var nextState;
      var modelScore;

      if (context && context.orderingEvaluator && orderingWeight !== 0) {
        nextState = engine.applyMove(state, candidate.move, candidate.promotion);
        modelScore = context.orderingEvaluator(nextState, context.rootColor);

        if (Number.isFinite(modelScore)) {
          score += (maximizing ? 1 : -1) * modelScore * orderingWeight;
        }
      }

      return {
        candidate: candidate,
        score: score
      };
    });

    scoredCandidates.sort(function compareCandidates(left, right) {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return compareCandidateMoves(
        { move: left.candidate.move, promotion: left.candidate.promotion, rules: rules },
        { move: right.candidate.move, promotion: right.candidate.promotion, rules: rules }
      );
    });

    return scoredCandidates.map(function unwrapCandidate(entry) {
      return entry.candidate;
    });
  }

  function resolveMaxDepth(candidateCount, options) {
    var explicitDepth = Number(options && (options.maxDepth || options.depth));
    var moveTime = Number(options && options.moveTime) || 0;

    if (explicitDepth > 0) {
      return explicitDepth;
    }

    if (candidateCount <= 8 && moveTime >= 900) {
      return 5;
    }

    if (candidateCount <= 16 && moveTime >= 500) {
      return 4;
    }

    return 3;
  }

  function createSearchContext(state, candidateCount, options, leafEvaluator, orderingEvaluator) {
    var moveTime = Number(options && options.moveTime) || 0;
    var blendWeight = Number(options && options.modelBlendWeight);
    var orderingWeight = Number(options && options.orderingWeight);

    if (!Number.isFinite(blendWeight)) {
      blendWeight = DEFAULT_MODEL_BLEND;
    }

    if (!Number.isFinite(orderingWeight)) {
      orderingWeight = 0.0025;
    }

    return {
      rootColor: state.turn,
      deadlineMs: moveTime > 0 ? nowMs() + Math.max(40, moveTime - 5) : null,
      maxDepth: resolveMaxDepth(candidateCount, options),
      nodes: 0,
      transposition: new Map(),
      leafEvaluator: leafEvaluator,
      modelBlendWeight: Math.max(0, Math.min(1, blendWeight)),
      orderingEvaluator: orderingEvaluator,
      orderingWeight: orderingWeight
    };
  }

  function evaluateLeafState(state, context, analysis) {
    var terminalScore = evaluateTerminalState(state, context.rootColor, analysis);
    var modelScore;
    var heuristicScore;

    if (terminalScore !== null) {
      return terminalScore;
    }

    heuristicScore = scoreHeuristicState(state, context.rootColor, analysis);

    if (!context.leafEvaluator) {
      return heuristicScore;
    }

    modelScore = context.leafEvaluator(state, context.rootColor, analysis);

    if (!Number.isFinite(modelScore)) {
      return heuristicScore;
    }

    if (context.modelBlendWeight >= 1) {
      return modelScore;
    }

    if (context.modelBlendWeight <= 0) {
      return heuristicScore;
    }

    return (modelScore * context.modelBlendWeight) + (heuristicScore * (1 - context.modelBlendWeight));
  }

  function alphaBeta(state, depth, alpha, beta, context, ply) {
    var key;
    var cached;
    var analysis;
    var candidates;
    var index;
    var nextState;
    var bestScore;
    var childScore;
    var maximizing = state.turn === context.rootColor;

    checkSearchBudget(context);
    key = stateKey(state);
    cached = context.transposition.get(key);

    if (cached && cached.depth >= depth) {
      return cached.score;
    }

    analysis = engine.analyzeState(state);

    if (depth <= 0 || analysis.status !== "active") {
      bestScore = evaluateLeafState(state, context, analysis);
      context.transposition.set(key, {
        depth: depth,
        score: bestScore
      });
      return bestScore;
    }

    candidates = orderCandidates(state, expandMoveCandidates(state), null, context);

    if (candidates.length === 0) {
      bestScore = evaluateLeafState(state, context, analysis);
      context.transposition.set(key, {
        depth: depth,
        score: bestScore
      });
      return bestScore;
    }

    bestScore = maximizing ? -Infinity : Infinity;

    for (index = 0; index < candidates.length; index += 1) {
      nextState = engine.applyMove(state, candidates[index].move, candidates[index].promotion);
      childScore = alphaBeta(nextState, depth - 1, alpha, beta, context, ply + 1);

      if (maximizing) {
        if (childScore > bestScore) {
          bestScore = childScore;
        }

        if (bestScore > alpha) {
          alpha = bestScore;
        }
      } else {
        if (childScore < bestScore) {
          bestScore = childScore;
        }

        if (bestScore < beta) {
          beta = bestScore;
        }
      }

      if (beta <= alpha) {
        break;
      }
    }

    context.transposition.set(key, {
      depth: depth,
      score: bestScore
    });
    return bestScore;
  }

  function selectBestCandidate(state, scoredCandidates, fallbackCandidate) {
    var bestCandidate = null;
    var bestScore = -Infinity;
    var index;
    var candidateScore;

    for (index = 0; index < scoredCandidates.length; index += 1) {
      candidateScore = scoredCandidates[index].score;

      if (!bestCandidate || candidateScore > bestScore) {
        bestCandidate = scoredCandidates[index].candidate;
        bestScore = candidateScore;
        continue;
      }

      if (candidateScore === bestScore &&
        compareCandidateMoves(
          { move: scoredCandidates[index].candidate.move, promotion: scoredCandidates[index].candidate.promotion, rules: state.rules },
          { move: bestCandidate.move, promotion: bestCandidate.promotion, rules: state.rules }
        ) < 0) {
        bestCandidate = scoredCandidates[index].candidate;
      }
    }

    return {
      candidate: bestCandidate || fallbackCandidate || null,
      score: bestCandidate ? bestScore : null
    };
  }

  function searchPosition(state, options) {
    var candidates = expandMoveCandidates(state);
    var heuristicChoice;
    var heuristicCandidate = null;
    var context;
    var completedBestCandidate = null;
    var completedBestScore = null;
    var completedDepth = 0;
    var depth;
    var orderedCandidates;
    var scoredCandidates;
    var candidateIndex;
    var nextState;
    var nextAnalysis;
    var score;
    var bestSelection;
    var leafEvaluator;
    var orderingEvaluator;

    if (candidates.length === 0) {
      return null;
    }

    heuristicChoice = chooseHeuristicMove(state, options);

    if (heuristicChoice) {
      for (candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
        if (candidates[candidateIndex].move.from.x === heuristicChoice.from.x &&
          candidates[candidateIndex].move.from.y === heuristicChoice.from.y &&
          candidates[candidateIndex].move.to.x === heuristicChoice.to.x &&
          candidates[candidateIndex].move.to.y === heuristicChoice.to.y &&
          candidates[candidateIndex].promotion === heuristicChoice.promotion) {
          heuristicCandidate = candidates[candidateIndex];
          break;
        }
      }
    }

    leafEvaluator = resolveLeafEvaluator(options);
    orderingEvaluator = resolveOrderingEvaluator(options);
    context = createSearchContext(state, candidates.length, options, leafEvaluator, orderingEvaluator);

    for (depth = 1; depth <= context.maxDepth; depth += 1) {
      try {
        orderedCandidates = orderCandidates(state, candidates, completedBestCandidate || heuristicCandidate, context);
        scoredCandidates = [];

        for (candidateIndex = 0; candidateIndex < orderedCandidates.length; candidateIndex += 1) {
          checkSearchBudget(context);
          nextState = engine.applyMove(state, orderedCandidates[candidateIndex].move, orderedCandidates[candidateIndex].promotion);
          nextAnalysis = engine.analyzeState(nextState);
          score = alphaBeta(nextState, depth - 1, -Infinity, Infinity, context, 1);
          score += moveBonus(
            orderedCandidates[candidateIndex].move,
            orderedCandidates[candidateIndex].promotion,
            nextAnalysis,
            state.rules
          );
          scoredCandidates.push({
            candidate: orderedCandidates[candidateIndex],
            score: score
          });
        }

        bestSelection = selectBestCandidate(state, scoredCandidates, heuristicCandidate);
        completedBestCandidate = bestSelection.candidate;
        completedBestScore = bestSelection.score;
        completedDepth = depth;
      } catch (error) {
        if (isSearchTimeout(error)) {
          break;
        }

        throw error;
      }
    }

    if (!completedBestCandidate) {
      return {
        move: heuristicChoice,
        score: null,
        depth: 0,
        nodes: context.nodes,
        fallback: "heuristic"
      };
    }

    return {
      move: {
        from: { x: completedBestCandidate.move.from.x, y: completedBestCandidate.move.from.y },
        to: { x: completedBestCandidate.move.to.x, y: completedBestCandidate.move.to.y },
        promotion: completedBestCandidate.promotion
      },
      score: completedBestScore,
      depth: completedDepth,
      nodes: context.nodes,
      fallback: null
    };
  }

  function chooseSearchMove(state, options) {
    var result = searchPosition(state, options);

    return result ? result.move : null;
  }

  function StockfishAdapter(options) {
    var config = options || {};

    this.classicEngine = config.classicEngine;
  }

  StockfishAdapter.prototype.init = function init() {
    return this.classicEngine ? this.classicEngine.init() : Promise.resolve();
  };

  StockfishAdapter.prototype.requestMove = function requestMove(game, options) {
    var self = this;

    if (!self.classicEngine) {
      return Promise.resolve(null);
    }

    return self.classicEngine.requestBestMove(game.getUciMoves(), options).then(parseUciMove);
  };

  StockfishAdapter.prototype.reset = function reset() {
    if (this.classicEngine) {
      this.classicEngine.reset();
    }
  };

  StockfishAdapter.prototype.getInfo = function getInfo() {
    return {
      id: "classic-stockfish",
      label: "Stockfish",
      family: "classic-search",
      supportsRules: function supportsRules(rules) {
        return engine.isClassicRules(rules);
      }
    };
  };

  function HeuristicVariantEngine() {
    this.requestToken = 0;
  }

  HeuristicVariantEngine.prototype.init = function init() {
    return Promise.resolve();
  };

  HeuristicVariantEngine.prototype.requestMove = function requestMove(game, options) {
    var self = this;
    var token = self.requestToken + 1;

    self.requestToken = token;

    return Promise.resolve().then(function chooseMoveAsync() {
      if (token !== self.requestToken) {
        return null;
      }

      return chooseHeuristicMove(game.state, options);
    });
  };

  HeuristicVariantEngine.prototype.reset = function reset() {
    this.requestToken += 1;
  };

  HeuristicVariantEngine.prototype.getInfo = function getInfo() {
    return {
      id: "prototype-heuristic",
      label: "Heuristic Baseline",
      family: "variant-heuristic",
      supportsRules: function supportsRules() {
        return true;
      }
    };
  };

  function SearchVariantEngine() {
    this.requestToken = 0;
  }

  SearchVariantEngine.prototype.init = function init() {
    return Promise.resolve();
  };

  SearchVariantEngine.prototype.requestMove = function requestMove(game, options) {
    var self = this;
    var token = self.requestToken + 1;

    self.requestToken = token;

    return new Promise(function resolveSearchMove(resolve, reject) {
      setTimeout(function runSearch() {
        if (token !== self.requestToken) {
          resolve(null);
          return;
        }

        try {
          resolve(chooseSearchMove(game.state, options));
        } catch (error) {
          reject(error);
        }
      }, 0);
    });
  };

  SearchVariantEngine.prototype.reset = function reset() {
    this.requestToken += 1;
  };

  SearchVariantEngine.prototype.getInfo = function getInfo() {
    return {
      id: "variant-search-prototype",
      label: "Variant Search",
      family: "variant-search",
      supportsRules: function supportsRules() {
        return true;
      }
    };
  };

  function ModelVariantEngine(options) {
    var config = options || {};

    this.requestToken = 0;
    this.valueModel = config.valueModel || null;
    this.orderingValueModel = config.orderingValueModel || null;
    this.modelBlendWeight = Number(config.modelBlendWeight);
    this.orderingWeight = Number(config.orderingWeight);
    this.label = config.label || "Model Search";
    this.id = config.id || "variant-model-search";
  }

  ModelVariantEngine.prototype.init = function init() {
    return Promise.resolve();
  };

  ModelVariantEngine.prototype.requestMove = function requestMove(game, options) {
    var self = this;
    var token = self.requestToken + 1;
    var mergedOptions = options || {};

    self.requestToken = token;

    return new Promise(function resolveModelSearchMove(resolve, reject) {
      setTimeout(function runModelSearch() {
        if (token !== self.requestToken) {
          resolve(null);
          return;
        }

        try {
          resolve(chooseSearchMove(game.state, {
            moveTime: mergedOptions.moveTime,
            maxDepth: mergedOptions.maxDepth,
            valueModel: self.valueModel,
            modelBlendWeight: self.modelBlendWeight,
            orderingValueModel: self.orderingValueModel,
            orderingWeight: self.orderingWeight
          }));
        } catch (error) {
          reject(error);
        }
      }, 0);
    });
  };

  ModelVariantEngine.prototype.reset = function reset() {
    this.requestToken += 1;
  };

  ModelVariantEngine.prototype.getInfo = function getInfo() {
    var self = this;

    return {
      id: self.id,
      label: self.label,
      family: "variant-hybrid",
      supportsRules: function supportsRules() {
        return true;
      }
    };
  };

  return {
    PIECE_VALUES: PIECE_VALUES,
    StockfishAdapter: StockfishAdapter,
    HeuristicVariantEngine: HeuristicVariantEngine,
    SearchVariantEngine: SearchVariantEngine,
    ModelVariantEngine: ModelVariantEngine,
    parseUciMove: parseUciMove,
    evaluateState: evaluateState,
    scoreHeuristicState: scoreHeuristicState,
    createValueModelEvaluator: createValueModelEvaluator,
    chooseHeuristicMove: chooseHeuristicMove,
    chooseSearchMove: chooseSearchMove,
    searchPosition: searchPosition
  };
}));
