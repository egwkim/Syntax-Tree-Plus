.DEFAULT_GOAL := build
DIST_DIR := dist
PAGES_BRANCH := gh-pages

# Targets share dist/, so never build them concurrently.
.NOTPARALLEL:

.PHONY: build
build: clean tsc copy

# Empty dist/ without removing it or its .git: it may be a gh-pages worktree,
# and either would break it until `git worktree prune`.
.PHONY: clean
clean:
	if [ -d "$(DIST_DIR)" ]; then \
		find $(DIST_DIR) -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +; \
	fi

.PHONY: serve
serve:
	pnpm exec serve $(DIST_DIR)

# Parser/serializer round-trip tests (Node's built-in runner, no deps).
# Runs against the compiled output in dist/, so build first.
.PHONY: test
test: build
	node --test test/*.test.mjs

# Copy files from src to dist excluding *.ts
.PHONY: copy
copy:
	mkdir -p $(DIST_DIR)
	cd src && \
	find . ! -name '*.ts' -type f -exec cp --parents {} ../$(DIST_DIR) \;

.PHONY: tsc
tsc:
	pnpm exec tsc

# Attach dist/ to the gh-pages branch as a git worktree. Idempotent; creates the
# branch from origin, or bootstraps a parentless one, only when it doesn't exist.
.PHONY: dist
dist:
	@set -e; \
	if [ "$$(git -C $(DIST_DIR) rev-parse --show-toplevel 2>/dev/null)" = "$$(pwd)/$(DIST_DIR)" ]; then \
		echo "$(DIST_DIR)/ is already a worktree ($$(git -C $(DIST_DIR) rev-parse --abbrev-ref HEAD))"; \
		exit 0; \
	fi; \
	git fetch origin $(PAGES_BRANCH) || true; \
	if ! git show-ref --verify --quiet refs/heads/$(PAGES_BRANCH); then \
		if git show-ref --verify --quiet refs/remotes/origin/$(PAGES_BRANCH); then \
			git branch $(PAGES_BRANCH) origin/$(PAGES_BRANCH); \
		else \
			git branch $(PAGES_BRANCH) \
				$$(git commit-tree $$(git mktree </dev/null) -m "Initialize $(PAGES_BRANCH)"); \
		fi; \
	fi; \
	rm -rf $(DIST_DIR); \
	git worktree prune; \
	git worktree add -f $(DIST_DIR) $(PAGES_BRANCH)

# A deploy must be reproducible by rebuilding the commit it names.
# Override with `make deploy ALLOW_DIRTY=1`.
.PHONY: check-clean
check-clean:
	@if [ -z "$(ALLOW_DIRTY)" ]; then \
		if ! git diff --quiet HEAD -- src tsconfig.json || \
		   [ -n "$$(git ls-files --others --exclude-standard -- src)" ]; then \
			echo "Refusing to deploy: uncommitted changes under src/ (or tsconfig.json)."; \
			echo "Commit them, or re-run with ALLOW_DIRTY=1."; \
			exit 1; \
		fi; \
	fi

# Replace gh-pages with one parentless commit naming the source commit it was
# built from. Forced because a parentless commit is never a fast-forward.
.PHONY: deploy
deploy: check-clean dist build
	cd $(DIST_DIR) && \
	git add --all && \
	commit=$$(git commit-tree $$(git write-tree) \
		-m "Deploy $$(git -C .. rev-parse --short HEAD)") && \
	git reset -q --hard $$commit && \
	git push --force origin HEAD:$(PAGES_BRANCH)
