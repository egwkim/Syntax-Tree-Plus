#!/usr/bin/env bash
# deploy-to-build-branch.sh
# Deploys the contents of src/ to the build branch for GitHub Pages

set -e

REPO_URL=$(git config --get remote.origin.url)
BRANCH=build
TMP_DIR=$(mktemp -d)

# Build step: copy static files (adjust if you have a build process)
cp -r src/* "$TMP_DIR"

# Save current branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

git fetch origin
if git show-ref --verify --quiet refs/heads/$BRANCH; then
  git branch -D $BRANCH
fi

git checkout --orphan $BRANCH
# Remove all files from index
git rm -rf . > /dev/null 2>&1 || true

# Copy built files to root
tar -C "$TMP_DIR" -cf - . | tar -xf -
rm -rf "$TMP_DIR"

git add .
git commit -m "Deploy to build branch"
git push -f origin $BRANCH

git checkout $CURRENT_BRANCH

echo "Deployed to $BRANCH branch. Set GitHub Pages source to /build branch root."
