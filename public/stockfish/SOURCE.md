# Stockfish (WebAssembly)

Fichiers `stockfish-18-lite-single.js` et `stockfish-18-lite-single.wasm` issus du paquet npm
`stockfish@18.0.8` (Stockfish.js de Nathan Rugg / Chess.com, basé sur Stockfish 18).

- Licence : GNU GPL v3 (voir `COPYING.txt`).
- Code source correspondant : https://github.com/nmrugg/stockfish.js (tag v18.0.8)
  et https://github.com/official-stockfish/Stockfish
- Variante « lite single-threaded » : ne nécessite pas d'isolation cross-origin (COOP/COEP).

Le moteur tourne dans un Web Worker séparé, chargé uniquement à la demande.
