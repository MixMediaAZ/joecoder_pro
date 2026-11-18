# Plan of Action

1. Review DRAFT_MANIFEST.json; mark genuinely-intended behaviors `required: true` and set severity.
2. Fill each behavior's Given/When/Then so a proof is obvious. Delete noise; add anything missing.
3. Tick **Operator approved** and **Approve & Save** (writes MANIFEST.json).
4. Press **Next Step**: it runs `manifest-lint`, then **Lock**.
5. Record real runtime proof for each required behavior (form or Node adapter).
6. **Run Full Check** → address blockers (copy-prompt or onboard AI) → repeat until SHIP.
