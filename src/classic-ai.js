(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ChessPlusAI = factory();
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function ClassicEngine(options) {
    var config = options || {};

    this.workerUrl = config.workerUrl;
    this.worker = null;
    this.initPromise = null;
    this.waiters = [];
    this.activeSearch = null;
  }

  ClassicEngine.prototype._ensureWorker = function ensureWorker() {
    var self = this;

    if (self.worker) {
      return;
    }

    self.worker = new Worker(self.workerUrl);
    self.worker.addEventListener("message", function onWorkerMessage(event) {
      self._handleLine(String(event.data || "").trim());
    });
    self.worker.addEventListener("error", function onWorkerError(event) {
      self._failAll(new Error(event.message || "Stockfish worker failed."));
      self.reset();
    });
  };

  ClassicEngine.prototype._handleLine = function handleLine(line) {
    var remaining = [];
    var index;
    var waiter;
    var matched;

    for (index = 0; index < this.waiters.length; index += 1) {
      waiter = this.waiters[index];
      matched = false;

      try {
        matched = waiter.predicate(line);
      } catch (error) {
        waiter.reject(error);
        continue;
      }

      if (matched) {
        waiter.resolve(line);
      } else {
        remaining.push(waiter);
      }
    }

    this.waiters = remaining;
  };

  ClassicEngine.prototype._waitForLine = function waitForLine(predicate) {
    var self = this;

    return new Promise(function onWait(resolve, reject) {
      self.waiters.push({
        predicate: predicate,
        resolve: resolve,
        reject: reject
      });
    });
  };

  ClassicEngine.prototype._send = function send(command) {
    if (!this.worker) {
      throw new Error("Stockfish worker is not initialized.");
    }

    this.worker.postMessage(command);
  };

  ClassicEngine.prototype._failAll = function failAll(error) {
    var pending = this.waiters.slice();
    var index;

    this.waiters = [];

    for (index = 0; index < pending.length; index += 1) {
      pending[index].reject(error);
    }
  };

  ClassicEngine.prototype.init = function init() {
    var self = this;
    var uciReady;

    self._ensureWorker();

    if (self.initPromise) {
      return self.initPromise;
    }

    uciReady = self._waitForLine(function onUciReady(line) {
      return line === "uciok";
    });

    self._send("uci");

    self.initPromise = uciReady.then(function afterUci() {
      var ready;

      ready = self._waitForLine(function onReadyOk(line) {
        return line === "readyok";
      });
      self._send("setoption name UCI_Chess960 value false");
      self._send("isready");
      return ready;
    });

    return self.initPromise;
  };

  ClassicEngine.prototype.requestBestMove = function requestBestMove(moves, options) {
    var self = this;
    var history = Array.isArray(moves) ? moves.slice() : [];
    var config = options || {};
    var moveTime = Number(config.moveTime) || 600;

    if (self.activeSearch) {
      return Promise.reject(new Error("Stockfish search already in progress."));
    }

    return Promise.resolve().then(function startInit() {
      return self.init();
    }).then(function afterInit() {
      return new Promise(function onSearch(resolve, reject) {
        var bestMoveReady = self._waitForLine(function onBestMove(line) {
          return line.indexOf("bestmove ") === 0;
        });

        self.activeSearch = {
          resolve: resolve,
          reject: reject
        };

        bestMoveReady.then(function onBestMoveLine(line) {
          var parts = line.split(/\s+/);

          self.activeSearch = null;
          resolve(parts[1] && parts[1] !== "(none)" ? parts[1] : null);
        }, function onBestMoveError(error) {
          self.activeSearch = null;
          reject(error);
        });

        self._send("position startpos" + (history.length ? " moves " + history.join(" ") : ""));
        self._send("go movetime " + moveTime);
      });
    });
  };

  ClassicEngine.prototype.reset = function reset() {
    if (this.worker) {
      this.worker.terminate();
    }

    if (this.activeSearch) {
      this.activeSearch.reject(new Error("Stockfish search cancelled."));
      this.activeSearch = null;
    }

    this._failAll(new Error("Stockfish worker reset."));
    this.worker = null;
    this.initPromise = null;
  };

  return {
    ClassicEngine: ClassicEngine
  };
}));
