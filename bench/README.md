# Danisa benchmark: Urdu, English and Punjabi medical conversations

This benchmark measures the three things that decide whether a voice AI is safe and useful in a Pakistani clinic. It uses the same rules and prompts as the live worker (`ai-worker/triage.js`, `ai-worker/report.js`), so you can measure every change before it ships.

| Task | Question | Metric |
|---|---|---|
| **Emergency detection** | Does Danisa send a stroke, cauda equina or DVT case to 1122 instead of booking a routine slot? | Emergency sensitivity / specificity, rules vs model vs both |
| **Report faithfulness** | Does the call report keep every fact and invent none? | Fact recall; "trap" facts claimed (hallucinations), judged by an LLM |
| **Transcription** | How well is Urdu / Roman Urdu / Punjabi / mixed speech written down? | Character and word error rate, batch model vs the live model used for call notes |

```sh
GEMINI_API_KEY=… node bench/run.mjs                 # all tasks, about 5 minutes
GEMINI_API_KEY=… node bench/run.mjs triage          # one task
```
Results are saved to `results/<date>.json` (every case) and `results/<date>.md` (the tables).

## Data
- `data/triage.jsonl`: 60 short messages in English, Urdu script, Roman Urdu, Punjabi and code-mixed text, labelled `emergency`, `urgent` or `routine`. **This is the development set: the red-flag rules were tuned on it.**
- `data/triage-holdout.jsonl`: 20 more messages written *after* the rules were tuned and never used for tuning. Only this set gives an honest score.
- `data/reports.jsonl`: 5 founder calls (sales, investor, hospital, internship, NGO). Each lists the facts a report must contain and "traps", plausible things that were never said.
- `data/asr.jsonl`: 8 sentences. The audio is synthesised with Gemini TTS and cached in `audio/` (git-ignored).

**All of this seed data is synthetic, written by the team.** It is good for catching regressions, but it isn't evidence for a paper.

## What the first run found
- On the development set the fixed red-flag rules started at **49/60**. They missed "can't control my bladder" and a sudden one-sided weakness phrased in Roman Urdu, and they false-alarmed on "I *don't* have chest pain" and on routine post-stroke rehab. After fixing those patterns the rules get 60/60, which is expected because they were tuned on that set.
- On the **held-out set the rules alone catch only 1 of 14 emergencies (8/20 overall)**. Real people describe emergencies in more ways than any word list covers ("I wet myself twice", "pressure near my heart and sweating"). The rules are a floor, not a safety system. The model layer has to carry detection, and the combined score on held-out data is the number to watch.

The numbers for the model and the combined system are in `results/`.

## Turning this into a publishable dataset
1. **Ethics:** add a recording-and-annotation protocol to the existing IRB approval. Get written consent (Urdu and English forms), allow withdrawal, and keep no names or numbers.
2. **Collect:**
   - real receptionist-style calls at the pilot clinic (bookings, questions);
   - physiotherapist–patient sessions (for SOAP notes);
   - read-aloud red-flag scenarios by patients and staff, across Urdu, Punjabi, Pashto, Saraiki and Roman-Urdu text.

   Aim for at least 300 triage items, 50 sessions and 2 hours of audio, balanced by gender and region.
3. **Label:** two physiotherapists label each item on their own; report agreement (Cohen's κ) and resolve disagreements with a third.
4. **Split:** freeze a test set before any tuning, and never tune on it.
5. **Report:** sensitivity with 95% confidence intervals, broken down by language. Name the models and their versions; every result file records them.

Safety rule for the product: a change to the triage rules or prompts ships only if emergency sensitivity on the held-out set does not drop.
