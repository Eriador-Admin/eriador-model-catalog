# Deferred: `.github/workflows/validate.yml`

The initial push (2026-07-09) landed everything except the CI workflow because the OAuth token used lacked `workflow` scope. To restore CI, do **one** of:

## Option A — add via GitHub UI (fastest)

1. In this repo → Actions → "set up a workflow yourself".
2. Rename the created file to `validate.yml`.
3. Paste the contents shown in [`ci-workflow-to-add.yml`](ci-workflow-to-add.yml) below.
4. Commit to `main`.

## Option B — grant `workflow` scope + push from local

1. GitHub → Settings → Developer settings → Personal access tokens → the token you use for `git push` → grant `workflow` scope.
2. `cd .tmp-eriador-catalog && git add .github/ && git commit -m "ci: add validate workflow" && git push`

Once the workflow file lands, delete this `DEFERRED-WORKFLOW.md` file and its sibling `ci-workflow-to-add.yml`.
