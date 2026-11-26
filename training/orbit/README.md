# Orbit Local: experimental tool-use fine-tuning

This is an **unrun prototype**, not a trained adapter. Orbit Local currently uses the unmodified WebLLM Gemma 2 2B instruction model and a prompt-based, five-tool bridge. No fine-tuned checkpoint or adapter has been produced or tested.

`make-dataset.mjs` generates synthetic examples (no user data) matching the app's current `LOCAL_TOOL_PROMPT` and exact tool-call format. It includes positive calls for each allowed tool and a few unsupported-action examples. The separate seven-item holdout is only a smoke test, **far too small to establish quality or safety**. Improve the data, broaden test cases, and check its license and accuracy before training. A model may overfit this small set, make incorrect calls, or falsely claim to have taken actions.

The config follows the structure of the [official Gemma LoRA example](https://github.com/google-deepmind/gemma/blob/main/examples/lora.py), but uses `Gemma2_2B`, the instruction-tuned Gemma 2 checkpoint and Kauldron's JSON data source. It has only been syntax-checked; package compatibility, checkpoint loading, training, convergence and inference have **not** been verified.

## Reproduce on suitable hardware

1. Obtain the **Gemma 2 2B IT Flax checkpoint and its matching tokenizer** from the official [checkpoint instructions](https://github.com/google-deepmind/gemma/blob/main/docs/checkpoints.md), after accepting applicable Gemma terms. Do not use an arbitrary GGUF or WebLLM model as a Flax checkpoint. The official project currently requires Python 3.12+, and its README recommends GPU memory for 2B models; LoRA training may need substantially more than inference. Install JAX for your hardware and the official Gemma source and dependencies following the upstream documentation. This config was based on source commit `19e2a13999ba10b818ee128dfe33a8d50afa1684`, not necessarily the older PyPI release. Set up a separate environment, not this web app's Node runtime.
   To actually fetch the official Flax weights after obtaining access, install `kagglehub` in your training environment and run:

   ```sh
   python training/orbit/fetch_checkpoint.py
   ```

   It prints the checkpoint and tokenizer paths as JSON for the training variables below. Kaggle may require authentication and acceptance of the model terms before the download. This uses the Kaggle cache and does not place weights in Git. The helper checks the documented `tokenizer.model` and `2b/` layout, but cannot validate a checkpoint's contents without loading it in Gemma.
2. Generate data with Node 22+:

   ```sh
   node training/orbit/make-dataset.mjs /path/to/orbit-data
   ```

3. Set environment variables to your local checkpoint directory, tokenizer file, and generated `train.json`, then run the trainer:

   ```sh
   export ORBIT_GEMMA_CHECKPOINT=/path/to/flax/checkpoint
   export ORBIT_GEMMA_TOKENIZER=/path/to/tokenizer.model
   export ORBIT_TRAIN_JSON=/path/to/orbit-data/train.json
   python -m kauldron.main --cfg=training/orbit/lora_config.py --cfg.workdir=/path/to/orbit-training-output
   ```

   Keep checkpoints and data outside the Git checkout. Inspect logs and validate the training actually completes. This config is an initial experiment, not a recommended production recipe.
4. Run **both** base and tuned models against identical held-out prompts, recording raw outputs as JSON string arrays in the same order as `eval.json`. Score each with `node training/orbit/evaluate.mjs /path/to/orbit-data/eval.json /path/to/predictions.json`. The score checks only tool selection and exact arguments; manually evaluate normal replies, unsupported actions, privacy, hallucinations and adversarial cases too.
5. Deploy only after an independently tested export/conversion. A Kauldron/JAX LoRA checkpoint is **not** directly usable by the browser's WebLLM/MLC runtime. A compatible adapter merge/conversion and model packaging must be implemented and verified before selecting it in Orbit Local. Alternatively, serve a compatible model behind the separately configured OpenAI-style included-AI endpoint. Do not label the current browser model as fine-tuned.

## Attempt in this environment

The official GitHub source was cloned and inspected. A real `kagglehub.model_download("google/gemma-2/flax/gemma2-2b-it")` attempt failed connecting to api.kaggle.com. Hugging Face and Google Storage checkpoint endpoints were also unreachable from this environment. There is no GPU, and the available Python is 3.11 while the inspected upstream source specifies 3.12+. A dry run confirmed that an older PyPI release can resolve for Python 3.11, but that does not supply the missing checkpoint or verify compatibility with this source-based configuration. Attempting the trainer stopped because Kauldron was not installed. No training, weights download or tuned-model evaluation was possible here.
