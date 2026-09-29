# Adil Kılınç — personal website

Source for my portfolio site, served by GitHub Pages.

## Structure

| File | Contents |
|---|---|
| `index.html` | Home page in French (the default language) |
| `en/index.html` | Home page in English |
| `styles.css` | Layout, typography, light and dark themes |
| `field.js` | The hero figure: a pixel-per-element mesh with a synthetic strain field |
| `site.js` | Shows the compact top bar once the hero has scrolled out of view |
| `fem/` | The FEM primer in French (`index.html`), plus the styles (`primer.css`) and interactive figures (`primer.js`) shared by both languages |
| `en/fem/` | The FEM primer in English |
| `lab/` | The finite element simulator in French (`index.html`), plus the solver (`fe.js`), interface (`lab.js`) and styles (`lab.css`) shared by both languages |
| `en/lab/` | The simulator in English |
| `vendor/katex/` | KaTeX, self-hosted, for the equations on the primer page (MIT licence) |
| `img/` | Portrait |

No build step and no framework: edit the HTML and push.

## Preview locally

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Two languages

French is the default and lives at the root; English lives under `en/`. The two versions of a page
share section ids, so the FR | EN switch keeps the reader on the same section. When you change the
text of one version, change the other one too. Figure labels and number formats come from the page's
`lang` attribute, in `fem/primer.js` (the `T` table) and `field.js`.

## Editing the FEM primer

Equations in `fem/index.html` are plain LaTeX: `\( ... \)` inline and `\[ ... \]` on their own line.
Write `&amp;` instead of `&` inside matrices. To let a multi-part equation wrap on phones, put each
part in its own `\[ ... \]` inside `<div class="eqs"> ... </div>`.

## The simulator

`lab/fe.js` is a self-contained plane-stress finite element solver (QM6 quadrilaterals, banded Cholesky)
that also runs in Node, so it can be tested outside the browser:

```bash
node -e "const FE=require('./lab/fe.js'); const r=FE.analyse(FE.SHAPES.cantilever(),'bending',205000,0.3); console.log(r.force)"
```

Specimens, their supports and allowed load cases are defined in `FE.SHAPES`; materials in `MATERIALS` at the
top of `lab/lab.js`. The verification table on the page is recomputed in the browser from the same code.

