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
  const candidates = [];
  const legalMoves = game.getAllLegalMoves();

  for (const move of legalMoves) {
    if (move.piece &&
      move.piece.type === "p" &&
      (move.to.y === 0 || move.to.y === 7)) {
      for (const promotion of ["q", "r", "b", "n"]) {
        candidates.push({ move, promotion });
      }

      continue;
    }

    candidates.push({ move, promotion: null });
  }

  return candidates;
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
    if (!options || (!options.valueModel && !options.orderingValueModel)) {
      throw new Error("Hybrid model search requires a valueModel or orderingValueModel payload.");
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
      searchScore: decision.score,
      searchDepth: decision.depth,
      searchNodes: decision.nodes,
      searchFallback: decision.fallback,
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
  parseArgs,
  parseRulesSpec,
  loadModelPayload,
  playGame,
  ensureParentDir,
  featureSchema: features.featureSchema
};
