(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./engine.js"));
  } else {
    root.ChessPlusFeatures = factory(root.ChessPlus);
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function (engine) {
  "use strict";

  var PIECE_PLANES = [
    { color: "w", type: "p", key: "wp" },
    { color: "w", type: "n", key: "wn" },
    { color: "w", type: "b", key: "wb" },
    { color: "w", type: "r", key: "wr" },
    { color: "w", type: "q", key: "wq" },
    { color: "w", type: "k", key: "wk" },
    { color: "b", type: "p", key: "bp" },
    { color: "b", type: "n", key: "bn" },
    { color: "b", type: "b", key: "bb" },
    { color: "b", type: "r", key: "br" },
    { color: "b", type: "q", key: "bq" },
    { color: "b", type: "k", key: "bk" }
  ];
  var CANONICAL_PIECE_PLANES = [
    { color: "self", type: "p", key: "self_p" },
    { color: "self", type: "n", key: "self_n" },
    { color: "self", type: "b", key: "self_b" },
    { color: "self", type: "r", key: "self_r" },
    { color: "self", type: "q", key: "self_q" },
    { color: "self", type: "k", key: "self_k" },
    { color: "opponent", type: "p", key: "opp_p" },
    { color: "opponent", type: "n", key: "opp_n" },
    { color: "opponent", type: "b", key: "opp_b" },
    { color: "opponent", type: "r", key: "opp_r" },
    { color: "opponent", type: "q", key: "opp_q" },
    { color: "opponent", type: "k", key: "opp_k" }
  ];

  function emptyPlane() {
    return new Array(64).fill(0);
  }

  function planeIndex(color, type) {
    var index;

    for (index = 0; index < PIECE_PLANES.length; index += 1) {
      if (PIECE_PLANES[index].color === color && PIECE_PLANES[index].type === type) {
        return index;
      }
    }

    return -1;
  }

  function canonicalPlaneIndex(piece, state) {
    var sideKey = piece.color === state.turn ? "self" : "opponent";
    var index;

    for (index = 0; index < CANONICAL_PIECE_PLANES.length; index += 1) {
      if (CANONICAL_PIECE_PLANES[index].color === sideKey &&
        CANONICAL_PIECE_PLANES[index].type === piece.type) {
        return index;
      }
    }

    return -1;
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

  function encodeStatePlanes(state, options) {
    var encoding = options && options.encoding === "canonical" ? "canonical" : "absolute";
    var planeTemplate = encoding === "canonical" ? CANONICAL_PIECE_PLANES : PIECE_PLANES;
    var planes = planeTemplate.map(function createPlane() {
      return emptyPlane();
    });
    var index;
    var piece;
    var encodedIndex;
    var boardIndex;

    for (index = 0; index < state.board.length; index += 1) {
      piece = state.board[index];

      if (!piece) {
        continue;
      }

      encodedIndex = encoding === "canonical"
        ? canonicalPlaneIndex(piece, state)
        : planeIndex(piece.color, piece.type);
      boardIndex = transformIndex(index, state, encoding);

      if (encodedIndex !== -1) {
        planes[encodedIndex][boardIndex] = 1;
      }
    }

    return planes;
  }

  function encodeCastlingRights(state, options) {
    var encoding = options && options.encoding === "canonical" ? "canonical" : "absolute";

    if (encoding === "canonical") {
      return [
        state.castlingRights[state.turn].k ? 1 : 0,
        state.castlingRights[state.turn].q ? 1 : 0,
        state.castlingRights[state.turn === "w" ? "b" : "w"].k ? 1 : 0,
        state.castlingRights[state.turn === "w" ? "b" : "w"].q ? 1 : 0
      ];
    }

    return [
      state.castlingRights.w.k ? 1 : 0,
      state.castlingRights.w.q ? 1 : 0,
      state.castlingRights.b.k ? 1 : 0,
      state.castlingRights.b.q ? 1 : 0
    ];
  }

  function encodeEnPassantPlane(state, options) {
    var encoding = options && options.encoding === "canonical" ? "canonical" : "absolute";
    var plane = emptyPlane();

    if (state.enPassant) {
      plane[transformIndex((state.enPassant.y * 8) + state.enPassant.x, state, encoding)] = 1;
    }

    return plane;
  }

  function encodeRuleFlags(state) {
    var rules = engine.normalizeRules(state.rules);

    return [
      rules.friendlyFire ? 1 : 0,
      rules.kamikaze ? 1 : 0,
      rules.wrapAround ? 1 : 0,
      rules.doubleDirectionPawns ? 1 : 0,
      rules.jumpPawns ? 1 : 0
    ];
  }

  function encodeStateVector(state, options) {
    var encoding = options && options.encoding === "canonical" ? "canonical" : "absolute";
    var vector = [];
    var planes = encodeStatePlanes(state, { encoding: encoding });
    var index;

    for (index = 0; index < planes.length; index += 1) {
      vector = vector.concat(planes[index]);
    }

    vector.push(encoding === "canonical" ? 1 : (state.turn === "w" ? 1 : 0));
    vector = vector.concat(encodeCastlingRights(state, { encoding: encoding }));
    vector = vector.concat(encodeEnPassantPlane(state, { encoding: encoding }));
    vector = vector.concat(encodeRuleFlags(state));
    return vector;
  }

  function encodeCanonicalStateVector(state) {
    return encodeStateVector(state, { encoding: "canonical" });
  }

  function encodeState(state, options) {
    var encoding = options && options.encoding === "canonical" ? "canonical" : "absolute";

    return {
      piecePlanes: encodeStatePlanes(state, { encoding: encoding }),
      sideToMove: encoding === "canonical" ? "self" : state.turn,
      castlingRights: encodeCastlingRights(state, { encoding: encoding }),
      enPassantPlane: encodeEnPassantPlane(state, { encoding: encoding }),
      ruleFlags: encodeRuleFlags(state)
    };
  }

  function encodeCanonicalState(state) {
    return encodeState(state, { encoding: "canonical" });
  }

  function featureSchema(options) {
    var encoding = options && options.encoding === "canonical" ? "canonical" : "absolute";

    return {
      encoding: encoding === "canonical" ? "canonical-v1" : "absolute-v1",
      piecePlanes: (encoding === "canonical" ? CANONICAL_PIECE_PLANES : PIECE_PLANES).map(function mapPlane(plane) {
        return plane.key;
      }),
      scalarFeatures: [
        encoding === "canonical" ? "canonical_perspective_active" : "side_to_move_white",
        encoding === "canonical" ? "castle_self_kingside" : "castle_white_kingside",
        encoding === "canonical" ? "castle_self_queenside" : "castle_white_queenside",
        encoding === "canonical" ? "castle_opponent_kingside" : "castle_black_kingside",
        encoding === "canonical" ? "castle_opponent_queenside" : "castle_black_queenside"
      ],
      extraPlanes: [
        "en_passant"
      ],
      ruleFlags: [
        "friendly_fire",
        "kamikaze",
        "wrap_around",
        "double_direction_pawns",
        "jump_pawns"
      ],
      vectorLength: 842
    };
  }

  return {
    CANONICAL_PIECE_PLANES: CANONICAL_PIECE_PLANES,
    PIECE_PLANES: PIECE_PLANES,
    encodeState: encodeState,
    encodeCanonicalState: encodeCanonicalState,
    encodeStateVector: encodeStateVector,
    encodeCanonicalStateVector: encodeCanonicalStateVector,
    featureSchema: featureSchema
  };
}));
