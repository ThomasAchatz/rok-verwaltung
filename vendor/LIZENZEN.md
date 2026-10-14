# Gebündelte Bibliotheken in docx-vendor.min.js

Gebaut mit `bun build --target=browser --format=iife --minify` aus den offiziellen Quellen:

| Bibliothek | Version | Lizenz | Quelle |
|---|---|---|---|
| docxtemplater | 3.70.1 | MIT | https://github.com/open-xml-templating/docxtemplater |
| pizzip | 3.3.0 | MIT oder GPLv3 (hier MIT) | https://github.com/open-xml-templating/pizzip |
| @xmldom/xmldom | 0.9.12 | MIT | https://github.com/xmldom/xmldom |
| pako | 2.1.0 | MIT und Zlib | https://github.com/nodeca/pako |

Einstiegsdatei des Bündels:

```js
import PizZip from "pizzip/es6/index.js";
import Docxtemplater from "docxtemplater/es6/docxtemplater.js";
window.PizZip = PizZip;
window.Docxtemplater = Docxtemplater;
```
