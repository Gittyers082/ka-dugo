/* QR CODE GENERATOR ADAPTED FROM TEAM DONOR SCRIPT */
(() => {
    function generateQrSvg(text) {
        const data = new TextEncoder().encode(String(text).slice(0, 32));
        const totalDataBytes = 34;
        const ecBytesCount = 10;
        const size = 25;
        // Build bit stream: Byte mode (0100) + 8-bit length + data + terminator
        const bits = [];
        const pushBits = (val, len) => {
            for (let i = len - 1; i >= 0; i--)
                bits.push((val >> i) & 1);
        };
        pushBits(0b0100, 4);
        pushBits(data.length, 8);
        data.forEach((b) => pushBits(b, 8));
        pushBits(0, Math.min(4, totalDataBytes * 8 - bits.length));
        while (bits.length % 8 !== 0)
            bits.push(0);
        const codewords = [];
        for (let i = 0; i < bits.length; i += 8) {
            let byte = 0;
            for (let j = 0; j < 8; j++)
                byte = (byte << 1) | bits[i + j];
            codewords.push(byte);
        }
        const padBytes = [0xec, 0x11];
        let padIdx = 0;
        while (codewords.length < totalDataBytes) {
            codewords.push(padBytes[padIdx++ % 2]);
        }
        // Reed-Solomon GF(256) Error Correction (10 EC codewords)
        const gfExp = new Uint8Array(512);
        const gfLog = new Uint8Array(256);
        let x = 1;
        for (let i = 0; i < 255; i++) {
            gfExp[i] = x;
            gfLog[x] = i;
            x <<= 1;
            if (x & 0x100)
                x ^= 0x11d;
        }
        for (let i = 255; i < 512; i++)
            gfExp[i] = gfExp[i - 255];
        const gfMul = (a, b) => a === 0 || b === 0 ? 0 : gfExp[gfLog[a] + gfLog[b]];
        let gen = [1];
        for (let i = 0; i < ecBytesCount; i++) {
            const next = new Array(gen.length + 1).fill(0);
            for (let j = 0; j < gen.length; j++) {
                next[j] ^= gen[j];
                next[j + 1] ^= gfMul(gen[j], gfExp[i]);
            }
            gen = next;
        }
        const ecc = new Array(ecBytesCount).fill(0);
        for (const b of codewords) {
            const factor = b ^ ecc.shift();
            ecc.push(0);
            for (let j = 0; j < ecBytesCount; j++) {
                ecc[j] ^= gfMul(gen[j + 1], factor);
            }
        }
        const allWords = [...codewords, ...ecc];
        // Initialize 25x25 matrix
        const matrix = Array.from({ length: size }, () => new Array(size).fill(null));
        const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
        const setModule = (r, c, dark) => {
            if (r >= 0 && r < size && c >= 0 && c < size) {
                matrix[r][c] = dark ? 1 : 0;
                reserved[r][c] = true;
            }
        };
        // Finder patterns + separators
        const drawFinder = (rowOffset, colOffset) => {
            for (let r = -1; r <= 7; r++) {
                for (let c = -1; c <= 7; c++) {
                    const inOuter = r >= 0 && r <= 6 && (c === 0 || c === 6);
                    const inTopBot = c >= 0 && c <= 6 && (r === 0 || r === 6);
                    const inCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4;
                    setModule(rowOffset + r, colOffset + c, inOuter || inTopBot || inCenter);
                }
            }
        };
        drawFinder(0, 0);
        drawFinder(0, size - 7);
        drawFinder(size - 7, 0);
        // Alignment pattern at (18, 18)
        for (let r = 16; r <= 20; r++) {
            for (let c = 16; c <= 20; c++) {
                const dist = Math.max(Math.abs(r - 18), Math.abs(c - 18));
                setModule(r, c, dist !== 1);
            }
        }
        // Timing patterns
        for (let i = 8; i < size - 8; i++) {
            setModule(6, i, i % 2 === 0);
            setModule(i, 6, i % 2 === 0);
        }
        // Dark module & reserve format areas
        setModule(size - 8, 8, true);
        for (let i = 0; i < 9; i++) {
            if (!reserved[8][i])
                reserved[8][i] = true;
            if (!reserved[i][8])
                reserved[i][8] = true;
        }
        for (let i = 0; i < 8; i++) {
            reserved[8][size - 1 - i] = true;
            reserved[size - 1 - i][8] = true;
        }
        // Place data bits in 2-col zig-zag with Mask 0 ((r + c) % 2 === 0)
        const fullBits = [];
        allWords.forEach((w) => {
            for (let i = 7; i >= 0; i--)
                fullBits.push((w >> i) & 1);
        });
        let bitIdx = 0;
        let upward = true;
        for (let col = size - 1; col > 0; col -= 2) {
            if (col === 6)
                col--;
            for (let step = 0; step < size; step++) {
                const r = upward ? size - 1 - step : step;
                for (let dc = 0; dc < 2; dc++) {
                    const c = col - dc;
                    if (!reserved[r][c]) {
                        const bit = bitIdx < fullBits.length ? fullBits[bitIdx++] : 0;
                        const mask = (r + c) % 2 === 0 ? 1 : 0;
                        matrix[r][c] = bit ^ mask;
                    }
                }
            }
            upward = !upward;
        }
        // Format Info for Level L (01) + Mask 0 (000) => 0x77c4
        const fmt = 0x77c4;
        const tlCoords = [
            [8, 0],
            [8, 1],
            [8, 2],
            [8, 3],
            [8, 4],
            [8, 5],
            [8, 7],
            [8, 8],
            [7, 8],
            [5, 8],
            [4, 8],
            [3, 8],
            [2, 8],
            [1, 8],
            [0, 8],
        ];
        for (let i = 0; i < 15; i++) {
            const bit = (fmt >> (14 - i)) & 1;
            const [r, c] = tlCoords[i];
            matrix[r][c] = bit;
        }
        for (let i = 0; i < 7; i++) {
            matrix[size - 1 - i][8] = (fmt >> (14 - i)) & 1;
        }
        for (let i = 7; i < 15; i++) {
            matrix[8][size - 15 + i] = (fmt >> (14 - i)) & 1;
        }
        // Render SVG paths
        let path = "";
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                if (matrix[r][c])
                    path += `M${c + 2},${r + 2}h1v1h-1z`;
            }
        }
        return `<svg viewBox="0 0 ${size + 4} ${size + 4}" width="100%" height="100%" shape-rendering="crispEdges" role="img" aria-label="Donor QR">
      ` +
            `<rect width="100%" height="100%" fill="#ffffff"/>
      ` +
            `<path d="${path}" fill="#2a0605"/>
    ` +
            `</svg>`;
    }
    window.KaDonorQr = generateQrSvg;
})();
