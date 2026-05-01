.DEFAULT_GOAL := help

PORT ?= 8000

.PHONY: help serve test check

help:
	@printf '%s\n' \
		'Available targets:' \
		'  make serve          Start a local web server on port $(PORT)' \
		'  make test           Run the automated rule tests' \
		'  make check          Syntax-check the browser scripts' \
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
	node --check src/app.js
