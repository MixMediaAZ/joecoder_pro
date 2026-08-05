# JoeCoder Pro 20.1 — run on Windows

## Wrong (what you just did)
You ran commands from:
  C:\Users\David
So Node looked for:
  C:\Users\David\tools\certify-mutation.mjs  → MODULE_NOT_FOUND
  C:\Users\David\dist\*.test.js              → 0 tests

## Right
1. cd into the **project root** (the folder that contains package.json, dist/, tools/, src/)

   Git Bash example:
     cd /c/Users/David/AI_BUILDS/JoeCoder_Pro_20.1

   CMD:
     cd C:\Users\David\AI_BUILDS\JoeCoder_Pro_20.1

2. Confirm:
     ls package.json tools dist
     # CMD: dir package.json & dir tools & dir dist

3. First time only:
     npm install
     npm run build

4. Then:
     node --test dist/*.test.js dist/database/*.test.js
     node tools/certify-mutation.mjs --self
     JC_MOCK_MODEL=1 node tools/e2e-live.mjs

5. Start:
     npm start
   Open the bootstrap URL printed in the terminal.

## If you do not have this build on disk yet
This session’s working tree is the certified 20.1 build. Copy the whole project
folder (including dist/, tools/, public/, plan/, schemas/, package.json) onto
your machine under AI_BUILDS, then run the steps above from that folder.

Mock model (JC_MOCK_MODEL=1) is for offline certification only.
For real repairs: start Ollama and leave JC_MOCK_MODEL unset.
