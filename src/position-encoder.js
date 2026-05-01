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

  function encodeStatePlanes(state) {
    var planes = PIECE_PLANES.map(function createPlane() {
      return emptyPlane();
    });
    var index;
    var piece;
    var encodedIndex;

    for (index = 0; index < state.board.length; index += 1) {
      piece = state.board[index];

      if (!piece) {
        continue;
      }

      encodedIndex = planeIndex(piece.color, piece.type);

      if (encodedIndex !== -1) {
        planes[encodedIndex][index] = 1;
      }
    }

    return planes;
  }

  function encodeCastlingRights(state) {
    return [
      state.castlingRights.w.k ? 1 : 0,
      state.castlingRights.w.q ? 1 : 0,
      state.castlingRights.b.k ? 1 : 0,
      state.castlingRights.b.q ? 1 : 0
    ];
  }

  function encodeEnPassantPlane(state) {
    var plane = emptyPlane();

    if (state.enPassant) {
      plane[(state.enPassant.y * 8) + state.enPassant.x] = 1;
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

  function encodeStateVector(state) {
    var vector = [];
    var planes = encodeStatePlanes(state);
    var index;

    for (index = 0; index < planes.length; index += 1) {
      vector = vector.concat(planes[index]);
    }

    vector.push(state.turn === "w" ? 1 : 0);
    vector = vector.concat(encodeCastlingRights(state));
    vector = vector.concat(encodeEnPassantPlane(state));
    vector = vector.concat(encodeRuleFlags(state));
    return vector;
  }

  function encodeState(state) {
    return {
      piecePlanes: encodeStatePlanes(state),
      sideToMove: state.turn,
      castlingRights: encodeCastlingRights(state),
      enPassantPlane: encodeEnPassantPlane(state),
      ruleFlags: encodeRuleFlags(state)
    };
  }

  function featureSchema() {
    return {
      piecePlanes: PIECE_PLANES.map(function mapPlane(plane) {
        return plane.key;
      }),
      scalarFeatures: [
        "side_to_move_white",
        "castle_white_kingside",
        "castle_white_queenside",
        "castle_black_kingside",
        "castle_black_queenside"
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
    PIECE_PLANES: PIECE_PLANES,
    encodeState: encodeState,
    encodeStateVector: encodeStateVector,
    featureSchema: featureSchema
  };
}));
