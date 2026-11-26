"""Experimental Orbit Local tool-use LoRA config for the official Gemma JAX library.

Adapted in structure from google-deepmind/gemma/examples/lora.py (Apache-2.0).
Requires a local Gemma 2 2B IT Flax checkpoint and its tokenizer; it does not
fetch or redistribute weights. This configuration has not been run here.
"""
import os
from kauldron import konfig

with konfig.imports():
    from gemma import gm
    from kauldron import kd
    import optax


def get_config():
    checkpoint = os.environ.get("ORBIT_GEMMA_CHECKPOINT")
    tokenizer_path = os.environ.get("ORBIT_GEMMA_TOKENIZER")
    dataset = os.environ.get("ORBIT_TRAIN_JSON")
    if not checkpoint or not tokenizer_path or not dataset:
        raise ValueError("Set ORBIT_GEMMA_CHECKPOINT, ORBIT_GEMMA_TOKENIZER and ORBIT_TRAIN_JSON to local paths.")
    tokenizer = gm.text.Gemma2Tokenizer(path=tokenizer_path)
    return kd.train.Trainer(
        seed=42,
        train_ds=kd.data.py.Json(
            path=dataset,
            shuffle=True,
            batch_size=1,
            num_workers=0,
            transforms=[gm.data.Seq2SeqTask(
                in_prompt="prompt", in_response="response",
                out_input="input", out_target="target", out_target_mask="loss_mask",
                tokenizer=tokenizer, max_length=768, truncate=False,
            )],
        ),
        model=gm.nn.LoRA(rank=4, model=gm.nn.Gemma2_2B(tokens="batch.input")),
        init_transform=gm.ckpts.SkipLoRA(wrapped=gm.ckpts.LoadCheckpoint(path=checkpoint)),
        num_train_steps=100,
        train_losses={"xentropy": kd.losses.SoftmaxCrossEntropyWithIntLabels(
            logits="preds.logits", labels="batch.target", mask="batch.loss_mask",
        )},
        optimizer=kd.optim.partial_updates(optax.adafactor(learning_rate=0.001), mask=kd.optim.select("lora")),
        checkpointer=kd.ckpts.Checkpointer(save_interval_steps=50),
    )
