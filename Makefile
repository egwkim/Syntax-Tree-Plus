.DEFAULT_GOAL := build
DIST_DIR := dist

# Build
.PHONY: build
build: clean tsc copy

# Removing the actual dist directory confuses git and will require a git worktree prune to fix
.PHONY: clean
clean:
	if [ -d "$(DIST_DIR)" ]; then rm -rf $(DIST_DIR)/*; fi


.PHONY: serve
serve:
	pnpm exec serve dist

# Copy files from src to dist excluding *.ts
.PHONY: copy
copy:
	cd src && \
	find ! -name '*.ts' -type f -exec cp --parents {} ../dist \;

# Build typescript
.PHONY: tsc
tsc:
	pnpm exec tsc
#	pnpm exec tsc --project tsconfig.prod.json

# Add worktree for gh-pages branch
# Reset dist worktree if it exists
.PHONY: dist
dist:
	stashed=$$(git stash) && \
	echo $$stashed && \
	if git checkout --orphan=gh-pages; then \
		git reset && \
		git commit --allow-empty -m "Initial commit" && \
		git switch -f main; \
	fi; \
	if [ -d "dist" ]; then \
		rm -r dist;\
	fi; \
	git worktree add -f --relative-paths dist gh-pages && \
	if [ ! "$${stashed%%Saved*}" ]; then \
		git stash pop; \
	fi

# Deploy to github page
.PHONY: deploy
deploy: build
	cd dist && \
	git add --all && \
	git commit -m "Deploy to gh-pages" && \
	git push origin gh-pages