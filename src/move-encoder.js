(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("./engine.js"),
      require("./position-encoder.js")
    );
  } else {
    root.ChessPlusMoveFeatures = factory(root.ChessPlus, root.ChessPlusFeatures);
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function (engine, features) {
  "use strict";

  var PIECE_TYPES = ["p", "n", "b", "r", "q", "k"];
  var PROMOTION_TYPES = ["q", "r", "b", "n"];

  function emptyPlane() {
    return new Array(64).fill(0);
  }

  function normalizeEncoding(options) {
    return options && options.encoding === "absolute" ? "absolute" : "canonical";
  }

  function transformIndex(index, state, encoding) {
    var x;
    var y;

    if (encoding !== "canonical" || state.turn === "w") {
      return index;
    }

    x = index % 8;
    y = Math.floor(index / 8);
    return ((7 - y) * 8) + (7 - x);
  }

  function transformCoord(coord, state, encoding) {
    var index;

    if (!coord) {
      return null;
    }

    index = transformIndex((coord.y * 8) + coord.x, state, encoding);
    return {
      x: index % 8,
      y: Math.floor(index / 8)
    };
  }

  function encodeSquarePlane(coord, state, encoding) {
    var plane = emptyPlane();

    if (!coord) {
      return plane;
    }

    plane[transformIndex((coord.y * 8) + coord.x, state, encoding)] = 1;
    return plane;
  }

  function encodeOneHot(value, values) {
    var vector = new Array(values.length).fill(0);
    var index = values.indexOf(value);

    if (index !== -1) {
      vector[index] = 1;
    }

    return vector;
  }

  function candidateToUci(candidate) {
    var move;

    if (!candidate || !candidate.move) {
      return null;
    }

    move = candidate.move;
    return engine.coordToAlgebraic(move.from.x, move.from.y) +
      engine.coordToAlgebraic(move.to.x, move.to.y) +
      (candidate.promotion ? String(candidate.promotion).toLowerCase() : "");
  }

  function moveDistanceScalars(state, candidate, encoding) {
    var from = transformCoord(candidate.move.from, state, encoding);
    var to = transformCoord(candidate.move.to, state, encoding);
    var dx = to.x - from.x;
    var dy = to.y - from.y;

    return [
      dx / 7,
      dy / 7,
      Math.abs(dx) / 7,
      Math.abs(dy) / 7,
      Math.max(Math.abs(dx), Math.abs(dy)) / 7
    ];
  }

  function encodeMoveScalars(state, candidate, options) {
    var legalMoveCount = Number(options && options.legalMoveCount);
    var scalars = [
      candidate.move.capture ? 1 : 0,
      candidate.move.isFriendlyCapture ? 1 : 0,
      candidate.move.isCastle ? 1 : 0,
      candidate.move.isEnPassant ? 1 : 0,
      candidate.move.crossesWrap ? 1 : 0,
      candidate.promotion ? 1 : 0,
      Number.isFinite(legalMoveCount) ? Math.min(1, legalMoveCount / 64) : 0
    ];

    return scalars.concat(moveDistanceScalars(state, candidate, normalizeEncoding(options)));
  }

  function encodeMoveVector(state, candidate, options) {
    var encoding = normalizeEncoding(options);
    var move = candidate && candidate.move ? candidate.move : null;
    var vector = [];

    if (!move) {
      return vector;
    }

    vector = vector.concat(encodeSquarePlane(move.from, state, encoding));
    vector = vector.concat(encodeSquarePlane(move.to, state, encoding));
    vector = vector.concat(encodeSquarePlane(move.captureSquare, state, encoding));
    vector = vector.concat(encodeOneHot(move.piece ? move.piece.type : null, PIECE_TYPES));
    vector = vector.concat(encodeOneHot(move.capture && move.capture.piece ? move.capture.piece.type : null, PIECE_TYPES));
    vector = vector.concat(encodeOneHot(candidate.promotion || null, PROMOTION_TYPES));
    vector = vector.concat(encodeMoveScalars(state, candidate, options));
    return vector;
  }

  function encodeCandidateVector(state, candidate, options) {
    var encoding = normalizeEncoding(options);
    var baseVector = options && Array.isArray(options.stateVector)
      ? options.stateVector.slice()
      : features.encodeStateVector(state, { encoding: encoding });

    return baseVector.concat(encodeMoveVector(state, candidate, {
      encoding: encoding,
      legalMoveCount: options && options.legalMoveCount
    }));
  }

  function featureSchema(options) {
    var encoding = normalizeEncoding(options);
    var positionSchema = features.featureSchema({ encoding: encoding });

    return {
      format: "chaos-chess-candidate-vector-v1",
      encoding: encoding,
      position: positionSchema,
      movePlanes: [
        "from_square",
        "to_square",
        "capture_square"
      ],
      movePieceType: PIECE_TYPES.slice(),
      capturePieceType: PIECE_TYPES.slice(),
      promotionType: PROMOTION_TYPES.slice(),
      scalarFeatures: [
        "is_capture",
        "is_friendly_capture",
        "is_castle",
        "is_en_passant",
        "crosses_wrap",
        "is_promotion",
        "legal_move_count_normalized",
        "delta_file_signed",
        "delta_rank_signed",
        "delta_file_abs",
        "delta_rank_abs",
        "delta_chebyshev"
      ],
      vectorLength: positionSchema.vectorLength + (64 * 3) + PIECE_TYPES.length + PIECE_TYPES.length + PROMOTION_TYPES.length + 12
    };
  }

  return {
    PIECE_TYPES: PIECE_TYPES,
    PROMOTION_TYPES: PROMOTION_TYPES,
    candidateToUci: candidateToUci,
    encodeCandidateVector: encodeCandidateVector,
    encodeMoveVector: encodeMoveVector,
    featureSchema: featureSchema
  };
}));
