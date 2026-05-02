const fs = require("node:fs");
const path = require("node:path");
const chess = require("../src/engine.js");
const computer = require("../src/computer-engines.js");
const features = require("../src/position-encoder.js");
const { createSeededRandom } = require("./ml-data.js");

const RULE_KEYS = Object.keys(chess.DEFAULT_RULES);
const MODEL_CACHE = new Map();

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];

    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    index += 1;
  }

  return args;
}

function sampleRules(randomFn) {
  const rules = {};
  const nextRandom = typeof randomFn === "function" ? randomFn : Math.random;

  for (const key of RULE_KEYS) {
    rules[key] = nextRandom() >= 0.5;
  }

  return chess.normalizeRules(rules);
}

function parseRulesSpec(spec, randomFn) {
  if (!spec || spec === "classic") {
    return chess.DEFAULT_RULES;
  }

  if (spec === "random") {
    return sampleRules(randomFn);
  }

  return chess.normalizeRules(spec.split(",").reduce((rules, rawKey) => {
    const key = rawKey.trim();

    if (RULE_KEYS.includes(key)) {
      rules[key] = true;
    }

    return rules;
  }, {}));
}

function legalCandidates(game) {
  return computer.expandMoveCandidates(game.state);
}

function cloneBoard(board) {
  return (board || []).map((piece) => (piece ? {
    color: piece.color,
    type: piece.type
  } : null));
}

function serializeState(state) {
  return {
    board: cloneBoard(state.board),
    turn: state.turn,
    rules: chess.normalizeRules(state.rules),
    castlingRights: {
      w: {
        k: Boolean(state.castlingRights && state.castlingRights.w && state.castlingRights.w.k),
        q: Boolean(state.castlingRights && state.castlingRights.w && state.castlingRights.w.q)
      },
      b: {
        k: Boolean(state.castlingRights && state.castlingRights.b && state.castlingRights.b.k),
        q: Boolean(state.castlingRights && state.castlingRights.b && state.castlingRights.b.q)
      }
    },
    enPassant: state.enPassant ? {
      x: state.enPassant.x,
      y: state.enPassant.y,
      pawnX: state.enPassant.pawnX,
      pawnY: state.enPassant.pawnY
    } : null,
    fullmoveNumber: Number.isFinite(Number(state.fullmoveNumber)) ? Number(state.fullmoveNumber) : 1
  };
}

function restoreState(snapshot) {
  if (!snapshot) {
    return null;
  }

  return {
    board: cloneBoard(snapshot.board),
    turn: snapshot.turn === "b" ? "b" : "w",
    rules: chess.normalizeRules(snapshot.rules),
    castlingRights: {
      w: {
        k: Boolean(snapshot.castlingRights && snapshot.castlingRights.w && snapshot.castlingRights.w.k),
        q: Boolean(snapshot.castlingRights && snapshot.castlingRights.w && snapshot.castlingRights.w.q)
      },
      b: {
        k: Boolean(snapshot.castlingRights && snapshot.castlingRights.b && snapshot.castlingRights.b.k),
        q: Boolean(snapshot.castlingRights && snapshot.castlingRights.b && snapshot.castlingRights.b.q)
      }
    },
    enPassant: snapshot.enPassant ? {
      x: Number(snapshot.enPassant.x),
      y: Number(snapshot.enPassant.y),
      pawnX: Number(snapshot.enPassant.pawnX),
      pawnY: Number(snapshot.enPassant.pawnY)
    } : null,
    fullmoveNumber: Number.isFinite(Number(snapshot.fullmoveNumber)) ? Number(snapshot.fullmoveNumber) : 1
  };
}

function loadModelPayload(modelPath) {
  const resolvedPath = path.resolve(process.cwd(), modelPath);

  if (MODEL_CACHE.has(resolvedPath)) {
    return MODEL_CACHE.get(resolvedPath);
  }

  const payload = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));

  MODEL_CACHE.set(resolvedPath, payload);
  return payload;
}

function chooseMove(bot, game, options) {
  if (bot === "heuristic") {
    return {
      move: computer.chooseHeuristicMove(game.state, options),
      score: null,
      depth: 1,
      nodes: null,
      fallback: null,
      engine: "heuristic"
    };
  }

  if (bot === "random") {
    const candidates = legalCandidates(game);
    const nextRandom = options && typeof options.randomFn === "function" ? options.randomFn : Math.random;
    const candidate = candidates[Math.floor(nextRandom() * candidates.length)] || null;

    return {
      move: candidate ? {
        from: { x: candidate.move.from.x, y: candidate.move.from.y },
        to: { x: candidate.move.to.x, y: candidate.move.to.y },
        promotion: candidate.promotion
      } : null,
      score: null,
      depth: 0,
      nodes: null,
      fallback: null,
      engine: "random"
    };
  }

  if (bot === "hybrid" || bot === "model" || bot === "model-search") {
    if (!options || (!options.valueModel && !options.orderingValueModel && !options.policyModel)) {
      throw new Error("Hybrid model search requires a valueModel, orderingValueModel, or policyModel payload.");
    }

    return {
      ...computer.searchPosition(game.state, options),
      engine: "hybrid"
    };
  }

  return {
    ...computer.searchPosition(game.state, options),
    engine: "search"
  };
}

function serializeDecision(decision) {
  if (!decision || !decision.move) {
    return null;
  }

  return {
    move: {
      from: { x: decision.move.from.x, y: decision.move.from.y },
      to: { x: decision.move.to.x, y: decision.move.to.y },
      promotion: decision.move.promotion || null
    },
    score: decision.score,
    depth: decision.depth,
    nodes: decision.nodes,
    fallback: decision.fallback,
    engine: decision.engine
  };
}

function simpleMoveToUci(move) {
  if (!move) {
    return null;
  }

  return chess.coordToAlgebraic(move.from.x, move.from.y) +
    chess.coordToAlgebraic(move.to.x, move.to.y) +
    (move.promotion ? String(move.promotion).toLowerCase() : "");
}

function outcomeForColor(summary, color) {
  if (summary.winner === null) {
    return 0;
  }

  return summary.winner === color ? 1 : -1;
}

function playGame(config) {
  const game = new chess.ChessGame(config.rules);
  const samples = [];
  const featureEncoding = config.featureEncoding === "canonical" ? "canonical" : "absolute";
  let ply = 0;

  while (game.analysis.status === "active" && ply < config.maxPlies) {
    const turn = game.state.turn;
    const bot = turn === "w" ? config.whiteBot : config.blackBot;
    const sideOptions = turn === "w" ? (config.whiteOptions || {}) : (config.blackOptions || {});
    const decision = chooseMove(bot, game, {
      ...sideOptions,
      randomFn: config.randomFn,
      moveTime: config.moveTime,
      maxDepth: config.maxDepth
    });
    const teacherDecision = config.teacherBot ? chooseMove(config.teacherBot, game, {
      ...(config.teacherOptions || {}),
      randomFn: config.randomFn,
      moveTime: Number(config.teacherOptions && config.teacherOptions.moveTime) || config.moveTime,
      maxDepth: Number.isFinite(Number(config.teacherOptions && config.teacherOptions.maxDepth))
        ? Number(config.teacherOptions.maxDepth)
        : config.maxDepth
    }) : null;

    if (!decision.move) {
      break;
    }

    const sample = {
      gameId: config.gameId,
      ply,
      engine: decision.engine,
      turn,
      rules: chess.normalizeRules(game.state.rules),
      legalMoveCount: game.analysis.legalMoves.length,
      featureEncoding,
      featureVector: features.encodeStateVector(game.state, { encoding: featureEncoding }),
      stateSnapshot: serializeState(game.state),
      searchScore: decision.score,
      searchDepth: decision.depth,
      searchNodes: decision.nodes,
      searchFallback: decision.fallback,
      teacherEngine: teacherDecision ? teacherDecision.engine : null,
      teacherScore: teacherDecision ? teacherDecision.score : null,
      teacherDepth: teacherDecision ? teacherDecision.depth : null,
      teacherNodes: teacherDecision ? teacherDecision.nodes : null,
      teacherFallback: teacherDecision ? teacherDecision.fallback : null,
      teacherMove: null,
      move: null,
      notation: null,
      outcome: null,
      finalStatus: null,
      winner: null
    };
    const result = game.move(
      decision.move.from.x,
      decision.move.from.y,
      decision.move.to.x,
      decision.move.to.y,
      decision.move.promotion
    );

    if (!result.ok) {
      throw new Error("Bot produced an illegal move during self-play.");
    }

    sample.move = result.uci;
    sample.notation = result.notation;
    if (teacherDecision && teacherDecision.move) {
      sample.teacherMove = simpleMoveToUci(teacherDecision.move);
    }
    samples.push(sample);
    ply += 1;
  }

  const summary = {
    gameId: config.gameId,
    rules: chess.normalizeRules(game.state.rules),
    plies: ply,
    status: game.analysis.status,
    winner: game.analysis.winner,
    moveCount: game.moveHistory.length
  };

  for (const sample of samples) {
    sample.outcome = outcomeForColor(summary, sample.turn);
    sample.finalStatus = summary.status;
    sample.winner = summary.winner;
  }

  return {
    game,
    samples,
    summary
  };
}

function ensureParentDir(outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
}

module.exports = {
  RULE_KEYS,
  createSeededRandom,
  legalCandidates,
  parseArgs,
  parseRulesSpec,
  loadModelPayload,
  playGame,
  restoreState,
  serializeDecision,
  serializeState,
  ensureParentDir,
  featureSchema: features.featureSchema
};
