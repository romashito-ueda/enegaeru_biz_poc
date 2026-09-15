# Third-party packages

The service installs the packages pinned in `requirements.txt`; it does not vendor their Python/native binaries. Preserve upstream license files when redistributing an installed environment. The installed wheels include full notices under their `*.dist-info` directories. License identifiers below were checked against the installed package metadata.

|Package|Version|License|Use|
|---|---|---|---|
|NLR-PySAM|8.0.0|BSD-3-Clause|Native SSC/PV/battery adapters (connected in subsequent issues)|
|NumPy|2.5.3|BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0|Numerical arrays; bundled components have additional notices|
|numpy-financial|1.0.0|BSD-3-Clause|Financial functions|
|jsonschema|4.26.0|MIT|Shared schema validation|
|rfc3339-validator|0.1.4|MIT|Timestamp validation|
|FastAPI|0.141.1|MIT|Local HTTP API|
|Uvicorn|0.53.0|BSD-3-Clause|ASGI server|
|HTTPX2|2.13.0|BSD-3-Clause|Starlette TestClient backend|

PySAM: `nlr_pysam-8.0.0.dist-info/licenses/LICENSE`. NumPy: `numpy-2.5.3.dist-info/licenses/LICENSE.txt` plus component notices in that directory. numpy-financial: `numpy_financial-1.0.0.dist-info/LICENSE.txt`. Dependency distribution names and versions, including transitive libraries, are listed in `requirements.txt`; their notices remain supplied by their wheels.
