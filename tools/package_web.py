#!/usr/bin/env python3
"""Package the MARKOV DREAMS browser player as one self-contained HTML file.
The page is web/index.html (the FM-1 panel); the firmware (WASM) and worklet are embedded.
The previous Mutable Dreams 1.2 release page is kept in web/legacy/ and is not built."""
from pathlib import Path
import base64,json,sys
R=Path(__file__).resolve().parents[1]
out=Path(sys.argv[1] if len(sys.argv)>1 else R/'app/build/browser/index.html');out.parent.mkdir(parents=True,exist_ok=True)
w=(R/'web/app_worklet.js').read_text()+(R/'web/worklet.js').read_text().replace('import "./app_worklet.js";','')
s=(R/'web/index.html').read_text()
s=s.replace('__WASM__',base64.b64encode((R/'app/build/wasm/dreams.wasm').read_bytes()).decode()).replace('__WORKLET__',json.dumps(w))
out.write_text(s);print(out)
