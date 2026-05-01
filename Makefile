.DEFAULT_GOAL := help

PORT ?= 8000

.PHONY: help serve test check selfplay benchmark

help:
	@printf '%s\n' \
		'Available targets:' \
		'  make serve          Start a local web server on port $(PORT)' \
		'  make test           Run the automated rule tests' \
		'  make check          Syntax-check the browser scripts' \
		'  make selfplay       Generate a small self-play dataset' \
		'  make benchmark      Compare search and heuristic bots' \
		'' \
		'Optional variables:' \
		'  PORT=9000           Override the local server port'

serve:
	python3 -m http.server $(PORT)

test:
	npm test

check:
	node --check src/engine.js
	node --check src/classic-ai.js
	node --check src/computer-engines.js
	node --check src/position-encoder.js
	node --check src/app.js
	node --check scripts/ai-common.js
	node --check scripts/selfplay.js
	node --check scripts/benchmark.js

selfplay:
	node scripts/selfplay.js

benchmark:
	node scripts/benchmark.js
