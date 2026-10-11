.PHONY: test demo demo-fixed docs-sync serve

PY ?= python3

test:
	$(PY) -m unittest discover -s tests
	node js/test.js
	node verifier/test/verifier.test.js
	node verifier/test/demo.test.js

# Terminal demo. Add ARGS=--online to also check the real public Hyperliquid record.
demo:
	$(PY) examples/demo.py $(ARGS)

# Same flow with a fixed time and nonce, so the output is identical on every run.
demo-fixed:
	$(PY) examples/demo.py --fixed $(ARGS)

# GitHub Pages serves docs/. Keep it a copy of verifier/ without tests and the README.
docs-sync:
	cd verifier && for f in index.html app.js demo.js demo-steps.js receipts.js approval-seal.js example-data.json; do cp $$f ../docs/$$f; done

serve:
	cd docs && $(PY) -m http.server 8765
