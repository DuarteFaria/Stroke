# Detailed analysis comparison

Full-frame analysis, follow disabled, same segments. Full15 → Heavy15 isolates the model; Heavy15 → Heavy30 isolates sampling rate. Timings are single CPU runs, not stable performance estimates.

| Clip | Variant | Samples | Left wrist coverage | Right wrist coverage | Runtime |
| --- | --- | ---: | ---: | ---: | ---: |
| back2 full15 | full15 | 21 | 42.9% | 47.6% | 0.75s |
| back2 heavy15 | heavy15 | 21 | 0.0% | 47.6% | 1.23s |
| back2 heavy30 | heavy30 | 41 | 4.9% | 36.6% | 1.99s |
| shortclose1 full15 | full15 | 20 | 25.0% | 75.0% | 0.63s |
| shortclose1 heavy15 | heavy15 | 20 | 20.0% | 100.0% | 1.15s |
| shortclose1 heavy30 | heavy30 | 40 | 37.5% | 100.0% | 1.93s |
| diagonal1 full15 | full15 | 36 | 97.2% | 100.0% | 0.87s |
| diagonal1 heavy15 | heavy15 | 36 | 100.0% | 100.0% | 1.88s |
| diagonal1 heavy30 | heavy30 | 72 | 100.0% | 100.0% | 3.32s |

Coverage is confidence >= .5 over all sampled frames. It is not positional accuracy. Higher sampling changes the evaluated timestamps; comparisons of joint accuracy require common manually annotated timestamps. Standard remains the default. These runs are preliminary and do not establish which option is more anatomically accurate.

Enable **Detalhada** and rerun detection for Heavy at up to 30 fps. Disable for Full at up to 15 fps. The selection and per-frame model identity are saved in projects. Old projects remain supported. Setup downloads both models; the installer build includes both. An existing installer is not updated by this change.

Reproduce standard and detailed with `analyze(video,start,end,quality="standard")` and `quality="detailed"`. For the intermediate Heavy15 experiment only, set `backend.main.MODEL` to the Heavy model and use standard sampling.
