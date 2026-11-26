# Using Gemma as deployment-provided AI

Bots can use a deployment-provided OpenAI-compatible inference service without requiring each user to supply a key. This is **not a bundled model**: the deployment operator must obtain the weights, run the service and pay for its compute. The app does not download weights or train a model at startup. When no included service is configured, the existing bring-your-own-provider flow is unchanged.

## Experimental browser mode

Select **Orbit Local Beta** in Settings → AI Provider and confirm the beta report to use it by default, or enable it for a single bot chat. Your existing hosted provider remains saved; select it in Settings to switch back. The account preference follows you to other devices, which must independently meet the browser and GPU requirements. No weights are downloaded until you send a local message. The app loads WebLLM on demand and attempts to download the `gemma-2-2b-it-q4f32_1-MLC` model into the browser's cache from Hugging Face. This is a quantized model conversion, not weights bundled in the repository. The model download can be several GB and requires a WebGPU-capable browser and adequate GPU memory; WebLLM lists about 2.5 GB VRAM for this configuration. Download availability and access to the model are governed by the upstream host and Gemma terms; accept any required terms before use. Downloading and running may fail on unsupported or constrained devices. No personal AI API key or separate inference server is needed for this mode.

Inference runs on the device, but this is **not an offline-only application**: the browser downloads code and model files from third parties, and completed chat exchanges are sent to the Bots server for persistence. Short recent conversation context and the bot's instructions are passed to the local model. Orbit Local is Gemma 2 under a new application name; it is not fine-tuned. It can request one of 11 read-only Bot tools per turn: calculate, convert_units, check_contrast, describe_numbers, get_current_time, date_math, analyze_text, transform_text, estimate_loan, convert_time_zones and compare_texts. Requests are sent to the app server, which validates arguments, checks skills and Privacy Mode, and returns the actual result without asking the model to summarize it. The model may not reliably select tools or produce the required format. It cannot browse, edit artifacts, access connected accounts or use the computer. Model answers may be incorrect or claim actions it cannot perform. There is no model-provider request quota for on-device inference, though the download host may impose limits. Stop or a failed download discards an unsaved exchange and restores the draft. Stopping while the model is loading stops waiting, but the initial download may continue in the background for reuse. Switching modes does not unload cached weights.

## Official Gemma project

The official [google-deepmind/gemma](https://github.com/google-deepmind/gemma) repository implements Google's JAX Gemma library. Its [checkpoint documentation](https://github.com/google-deepmind/gemma/blob/main/docs/checkpoints.md) describes obtaining Flax weights from Kaggle, including `google/gemma-3/flax/gemma3-1b-it`. Review the model's terms and obtain the appropriate access before downloading. The repository itself is code, not the model weights. Gemma's [README](https://github.com/google-deepmind/gemma#system-requirements) gives hardware guidance; practical memory and performance depend on model, quantization, context length and runtime.

For fine-tuning, see the official [LoRA example](https://github.com/google-deepmind/gemma/blob/main/examples/lora.py) and [tool-use notebook](https://github.com/google-deepmind/gemma/blob/main/colabs/tool_use.ipynb). The LoRA example trains on a translation dataset, **not** tool-use data. Training for Bots would require a suitable, licensed tool-use dataset, separate evaluation data, sufficient compute, and an inference runtime capable of loading the resulting adapter. No such fine-tuning or evaluation has been performed here. A model that can generate text does not automatically support OpenAI function calls, nor does fine-tuning by itself guarantee reliable or safe tool use.

## Serving and configuration

The JAX library and `ToolSampler` are not themselves an OpenAI-compatible streaming server. Deploy a separate server or adapter that can load your chosen checkpoint and supports **OpenAI-compatible streaming `/v1/chat/completions` with function `tools` and tool-result messages**. Verify that the specific model and server combination handles multi-step tool calls before enabling it; support varies. Bots executes its own tools under its existing permissions; do not give the inference server direct access to the app's credentials or filesystem.

Configure these server-side variables:

```env
INCLUDED_AI_BASE_URL=https://your-inference-host.example.com/v1
INCLUDED_AI_MODEL=your-served-gemma-model
INCLUDED_AI_API_KEY=optional-inference-server-secret
```

Both the base URL and model are required. `INCLUDED_AI_API_KEY` is optional for a private keyless server. With no personal provider, a user is routed to the configured model; a personally configured provider takes precedence. Included AI uses only the operator-configured model, including for bots with an older model selection. Removing a personal provider returns the user to included AI if configured. The API key and server URL are not sent to the browser as included-provider settings.

The service must be reachable **from the app server**, not the user's browser. On Vercel, `localhost` refers to the serverless function, not the operator's computer; host inference separately. Expose it over HTTPS with authentication. Establish quotas, per-user rate limits, monitoring, abuse prevention, privacy/retention terms, and a budget before enabling shared inference. A configured endpoint is not a health check or availability guarantee. The inference host receives the user's prompts, conversation context and tool definitions/results. No guarantee of free infrastructure, uptime, model quality, or tool correctness is implied.
