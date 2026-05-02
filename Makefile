.DEFAULT_GOAL := help

PORT ?= 8000

.PHONY: help serve test check selfplay benchmark benchmark-sweep export-dataset export-policy-dataset train-value train-value-torch train-policy-torch eval-value setup-torch

help:
	@printf '%s\n' \
		'Available targets:' \
		'  make serve          Start a local web server on port $(PORT)' \
		'  make test           Run the automated rule tests' \
		'  make check          Syntax-check the browser scripts' \
		'  make selfplay       Generate a small self-play dataset' \
		'  make export-dataset Build train/validation value datasets' \
		'  make export-policy-dataset Build train/validation policy datasets' \
		'  make train-value    Train the first value model' \
		'  make train-value-torch Train a PyTorch value model (.venv)' \
		'  make train-policy-torch Train a PyTorch policy model (.venv)' \
		'  make eval-value     Evaluate a saved value model' \
		'  make setup-torch    Install PyTorch deps into .venv' \
		'  make benchmark      Compare search and heuristic bots' \
		'  make benchmark-sweep Run a color-balanced AI benchmark sweep' \
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
	node --check src/move-encoder.js
	node --check src/position-encoder.js
	node --check src/app.js
	node --check scripts/ai-common.js
	node --check scripts/ml-data.js
	node --check scripts/selfplay.js
	node --check scripts/benchmark.js
	node --check scripts/benchmark-sweep.js
	node --check scripts/export-dataset.js
	node --check scripts/export-policy-dataset.js
	PYTHONPYCACHEPREFIX=/tmp/chess-plus-pycache python3 -m py_compile scripts/value_model.py scripts/train-value-model.py scripts/eval-value-model.py scripts/train-value-model-torch.py scripts/train-policy-model-torch.py

selfplay:
	node scripts/selfplay.js

benchmark:
	node scripts/benchmark.js

benchmark-sweep:
	node scripts/benchmark-sweep.js

export-dataset:
	node scripts/export-dataset.js

export-policy-dataset:
	node scripts/export-policy-dataset.js

train-value:
	python3 scripts/train-value-model.py

train-value-torch:
	./.venv/bin/python scripts/train-value-model-torch.py

train-policy-torch:
	./.venv/bin/python scripts/train-policy-model-torch.py

eval-value:
	python3 scripts/eval-value-model.py

setup-torch:
	test -d .venv || python3 -m venv .venv
	./.venv/bin/python -m pip install -r requirements-torch.txt
