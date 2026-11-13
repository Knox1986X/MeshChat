var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// node_modules/hash-wasm/dist/argon2.umd.min.js
var require_argon2_umd_min = __commonJS({
  "node_modules/hash-wasm/dist/argon2.umd.min.js"(exports, module) {
    !(function(A, I) {
      "object" == typeof exports && "undefined" != typeof module ? I(exports) : "function" == typeof define && define.amd ? define(["exports"], I) : I((A = "undefined" != typeof globalThis ? globalThis : A || self).hashwasm = A.hashwasm || {});
    })(exports, function(A) {
      "use strict";
      function I(A2, I2, i2, g2) {
        return new (i2 || (i2 = Promise))(function(C2, B2) {
          function Q2(A3) {
            try {
              h2(g2.next(A3));
            } catch (A4) {
              B2(A4);
            }
          }
          function E2(A3) {
            try {
              h2(g2.throw(A3));
            } catch (A4) {
              B2(A4);
            }
          }
          function h2(A3) {
            var I3;
            A3.done ? C2(A3.value) : (I3 = A3.value, I3 instanceof i2 ? I3 : new i2(function(A4) {
              A4(I3);
            })).then(Q2, E2);
          }
          h2((g2 = g2.apply(A2, I2 || [])).next());
        });
      }
      "function" == typeof SuppressedError && SuppressedError;
      var i, g = { name: "argon2", data: "AGFzbQEAAAABKQVgAX8Bf2AAAX9gEH9/f39/f39/f39/f39/f38AYAR/f39/AGACf38AAwYFAAECAwQFBgEBAoCAAgYIAX8BQYCABAsHUwUGbWVtb3J5AgAPX19zdGFja19wb2ludGVyAwASSGFzaF9TZXRNZW1vcnlTaXplAAAOSGFzaF9HZXRCdWZmZXIAAQ5IYXNoX0NhbGN1bGF0ZQAECsc2BV0DAX8BfgF/QQAhAQJAIABBACkDiIAEIgKnIgNGDQBBACEBAkAgACADayIAQRB2IABB//8DcUEAR2oiAEAAQX9HDQBB/wHADwtBACACIABBEHStfDcDiIAECyABwAt0AwJ/AX4BfwJAQQAoAoCABCIADQBBAD8AQRB0IgE2AoCABAJAQQApA4iABCICpyIDQYCAIEYNAEEAIQBBgIAgIANrIgNBEHYgA0H//wNxQQBHaiIDQABBf0YNAUEAIAIgA0EQdK18NwOIgAQLIAEhAAsgAAvcDgECfiAAIAQpAwAiECAAKQMAIhF8IBFCAYZC/v///x+DIBBC/////w+DfnwiEDcDACAMIBAgDCkDAIVCIIkiEDcDACAIIBAgCCkDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgBCAQIAQpAwCFQiiJIhA3AwAgACAQIAApAwAiEXwgEEL/////D4MgEUIBhkL+////H4N+fCIQNwMAIAwgECAMKQMAhUIwiSIQNwMAIAggECAIKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACAEIBAgBCkDAIVCAYk3AwAgASAFKQMAIhAgASkDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgDSAQIA0pAwCFQiCJIhA3AwAgCSAQIAkpAwAiEXwgEUIBhkL+////H4MgEEL/////D4N+fCIQNwMAIAUgECAFKQMAhUIoiSIQNwMAIAEgECABKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACANIBAgDSkDAIVCMIkiEDcDACAJIBAgCSkDACIRfCAQQv////8PgyARQgGGQv7///8fg358IhA3AwAgBSAQIAUpAwCFQgGJNwMAIAIgBikDACIQIAIpAwAiEXwgEUIBhkL+////H4MgEEL/////D4N+fCIQNwMAIA4gECAOKQMAhUIgiSIQNwMAIAogECAKKQMAIhF8IBFCAYZC/v///x+DIBBC/////w+DfnwiEDcDACAGIBAgBikDAIVCKIkiEDcDACACIBAgAikDACIRfCAQQv////8PgyARQgGGQv7///8fg358IhA3AwAgDiAQIA4pAwCFQjCJIhA3AwAgCiAQIAopAwAiEXwgEEL/////D4MgEUIBhkL+////H4N+fCIQNwMAIAYgECAGKQMAhUIBiTcDACADIAcpAwAiECADKQMAIhF8IBFCAYZC/v///x+DIBBC/////w+DfnwiEDcDACAPIBAgDykDAIVCIIkiEDcDACALIBAgCykDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgByAQIAcpAwCFQiiJIhA3AwAgAyAQIAMpAwAiEXwgEEL/////D4MgEUIBhkL+////H4N+fCIQNwMAIA8gECAPKQMAhUIwiSIQNwMAIAsgECALKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACAHIBAgBykDAIVCAYk3AwAgACAFKQMAIhAgACkDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgDyAQIA8pAwCFQiCJIhA3AwAgCiAQIAopAwAiEXwgEUIBhkL+////H4MgEEL/////D4N+fCIQNwMAIAUgECAFKQMAhUIoiSIQNwMAIAAgECAAKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACAPIBAgDykDAIVCMIkiEDcDACAKIBAgCikDACIRfCAQQv////8PgyARQgGGQv7///8fg358IhA3AwAgBSAQIAUpAwCFQgGJNwMAIAEgBikDACIQIAEpAwAiEXwgEUIBhkL+////H4MgEEL/////D4N+fCIQNwMAIAwgECAMKQMAhUIgiSIQNwMAIAsgECALKQMAIhF8IBFCAYZC/v///x+DIBBC/////w+DfnwiEDcDACAGIBAgBikDAIVCKIkiEDcDACABIBAgASkDACIRfCAQQv////8PgyARQgGGQv7///8fg358IhA3AwAgDCAQIAwpAwCFQjCJIhA3AwAgCyAQIAspAwAiEXwgEEL/////D4MgEUIBhkL+////H4N+fCIQNwMAIAYgECAGKQMAhUIBiTcDACACIAcpAwAiECACKQMAIhF8IBFCAYZC/v///x+DIBBC/////w+DfnwiEDcDACANIBAgDSkDAIVCIIkiEDcDACAIIBAgCCkDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgByAQIAcpAwCFQiiJIhA3AwAgAiAQIAIpAwAiEXwgEEL/////D4MgEUIBhkL+////H4N+fCIQNwMAIA0gECANKQMAhUIwiSIQNwMAIAggECAIKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACAHIBAgBykDAIVCAYk3AwAgAyAEKQMAIhAgAykDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgDiAQIA4pAwCFQiCJIhA3AwAgCSAQIAkpAwAiEXwgEUIBhkL+////H4MgEEL/////D4N+fCIQNwMAIAQgECAEKQMAhUIoiSIQNwMAIAMgECADKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACAOIBAgDikDAIVCMIkiEDcDACAJIBAgCSkDACIRfCAQQv////8PgyARQgGGQv7///8fg358IhA3AwAgBCAQIAQpAwCFQgGJNwMAC+MdAQN/QQAhBEEAIAIpAwAgASkDAIU3A5CABEEAIAIpAwggASkDCIU3A5iABEEAIAIpAxAgASkDEIU3A6CABEEAIAIpAxggASkDGIU3A6iABEEAIAIpAyAgASkDIIU3A7CABEEAIAIpAyggASkDKIU3A7iABEEAIAIpAzAgASkDMIU3A8CABEEAIAIpAzggASkDOIU3A8iABEEAIAIpA0AgASkDQIU3A9CABEEAIAIpA0ggASkDSIU3A9iABEEAIAIpA1AgASkDUIU3A+CABEEAIAIpA1ggASkDWIU3A+iABEEAIAIpA2AgASkDYIU3A/CABEEAIAIpA2ggASkDaIU3A/iABEEAIAIpA3AgASkDcIU3A4CBBEEAIAIpA3ggASkDeIU3A4iBBEEAIAIpA4ABIAEpA4ABhTcDkIEEQQAgAikDiAEgASkDiAGFNwOYgQRBACACKQOQASABKQOQAYU3A6CBBEEAIAIpA5gBIAEpA5gBhTcDqIEEQQAgAikDoAEgASkDoAGFNwOwgQRBACACKQOoASABKQOoAYU3A7iBBEEAIAIpA7ABIAEpA7ABhTcDwIEE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", hash: "2b50b0d6" };
      class C {
        constructor() {
          this.mutex = Promise.resolve();
        }
        lock() {
          let A2 = () => {
          };
          return this.mutex = this.mutex.then(() => new Promise(A2)), new Promise((I2) => {
            A2 = I2;
          });
        }
        dispatch(A2) {
          return I(this, void 0, void 0, function* () {
            const I2 = yield this.lock();
            try {
              return yield Promise.resolve(A2());
            } finally {
              I2();
            }
          });
        }
      }
      const B = "undefined" != typeof globalThis ? globalThis : "undefined" != typeof self ? self : "undefined" != typeof window ? window : global, Q = null !== (i = B.Buffer) && void 0 !== i ? i : null, E = B.TextEncoder ? new B.TextEncoder() : null;
      function h(A2, I2) {
        return (15 & A2) + (A2 >> 6 | A2 >> 3 & 8) << 4 | (15 & I2) + (I2 >> 6 | I2 >> 3 & 8);
      }
      function w(A2, I2) {
        const i2 = I2.length >> 1;
        for (let g2 = 0; g2 < i2; g2++) {
          const i3 = g2 << 1;
          A2[g2] = h(I2.charCodeAt(i3), I2.charCodeAt(i3 + 1));
        }
      }
      const e = "a".charCodeAt(0) - 10, t = "0".charCodeAt(0);
      function o(A2, I2, i2) {
        let g2 = 0;
        for (let C2 = 0; C2 < i2; C2++) {
          let i3 = I2[C2] >>> 4;
          A2[g2++] = i3 > 9 ? i3 + e : i3 + t, i3 = 15 & I2[C2], A2[g2++] = i3 > 9 ? i3 + e : i3 + t;
        }
        return String.fromCharCode.apply(null, A2);
      }
      const n = null !== Q ? (A2) => {
        if ("string" == typeof A2) {
          const I2 = Q.from(A2, "utf8");
          return new Uint8Array(I2.buffer, I2.byteOffset, I2.length);
        }
        if (Q.isBuffer(A2)) return new Uint8Array(A2.buffer, A2.byteOffset, A2.length);
        if (ArrayBuffer.isView(A2)) return new Uint8Array(A2.buffer, A2.byteOffset, A2.byteLength);
        throw new Error("Invalid data type!");
      } : (A2) => {
        if ("string" == typeof A2) return E.encode(A2);
        if (ArrayBuffer.isView(A2)) return new Uint8Array(A2.buffer, A2.byteOffset, A2.byteLength);
        throw new Error("Invalid data type!");
      }, f = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", r = new Uint8Array(256);
      for (let A2 = 0; A2 < 64; A2++) r[f.charCodeAt(A2)] = A2;
      function F(A2, I2 = true) {
        const i2 = A2.length, g2 = i2 % 3, C2 = [], B2 = i2 - g2;
        for (let I3 = 0; I3 < B2; I3 += 3) {
          const i3 = (A2[I3] << 16 & 16711680) + (A2[I3 + 1] << 8 & 65280) + (255 & A2[I3 + 2]), g3 = f.charAt(i3 >> 18 & 63) + f.charAt(i3 >> 12 & 63) + f.charAt(i3 >> 6 & 63) + f.charAt(63 & i3);
          C2.push(g3);
        }
        if (1 === g2) {
          const g3 = A2[i2 - 1], B3 = f.charAt(g3 >> 2), Q2 = f.charAt(g3 << 4 & 63);
          C2.push(`${B3}${Q2}`), I2 && C2.push("==");
        } else if (2 === g2) {
          const g3 = (A2[i2 - 2] << 8) + A2[i2 - 1], B3 = f.charAt(g3 >> 10), Q2 = f.charAt(g3 >> 4 & 63), E2 = f.charAt(g3 << 2 & 63);
          C2.push(`${B3}${Q2}${E2}`), I2 && C2.push("=");
        }
        return C2.join("");
      }
      function D(A2) {
        let I2 = Math.floor(0.75 * A2.length);
        const i2 = A2.length;
        return "=" === A2[i2 - 1] && (I2 -= 1, "=" === A2[i2 - 2] && (I2 -= 1)), I2;
      }
      function a(A2) {
        const I2 = D(A2), i2 = A2.length, g2 = new Uint8Array(I2);
        let C2 = 0;
        for (let I3 = 0; I3 < i2; I3 += 4) {
          const i3 = r[A2.charCodeAt(I3)], B2 = r[A2.charCodeAt(I3 + 1)], Q2 = r[A2.charCodeAt(I3 + 2)], E2 = r[A2.charCodeAt(I3 + 3)];
          g2[C2] = i3 << 2 | B2 >> 4, C2 += 1, g2[C2] = (15 & B2) << 4 | Q2 >> 2, C2 += 1, g2[C2] = (3 & Q2) << 6 | 63 & E2, C2 += 1;
        }
        return g2;
      }
      const s = 16384, U = new C(), S = /* @__PURE__ */ new Map();
      function c(A2, i2) {
        return I(this, void 0, void 0, function* () {
          let g2 = null, C2 = null, B2 = false;
          if ("undefined" == typeof WebAssembly) throw new Error("WebAssembly is not supported in this environment!");
          const Q2 = () => new DataView(g2.exports.memory.buffer).getUint32(g2.exports.STATE_SIZE, true), E2 = U.dispatch(() => I(this, void 0, void 0, function* () {
            if (!S.has(A2.name)) {
              const I3 = a(A2.data), i3 = WebAssembly.compile(I3.buffer);
              S.set(A2.name, i3);
            }
            const I2 = yield S.get(A2.name);
            g2 = yield WebAssembly.instantiate(I2, {});
          })), e2 = (A3 = null) => {
            B2 = true, g2.exports.Hash_Init(A3);
          }, t2 = (A3) => {
            if (!B2) throw new Error("update() called before init()");
            ((A4) => {
              let I2 = 0;
              for (; I2 < A4.length; ) {
                const i3 = A4.subarray(I2, I2 + s);
                I2 += i3.length, C2.set(i3), g2.exports.Hash_Update(i3.length);
              }
            })(n(A3));
          }, f2 = new Uint8Array(2 * i2), r2 = (A3, I2 = null) => {
            if (!B2) throw new Error("digest() called before init()");
            return B2 = false, g2.exports.Hash_Final(I2), "binary" === A3 ? C2.slice(0, i2) : o(f2, C2, i2);
          }, F2 = (A3) => "string" == typeof A3 ? A3.length < 4096 : A3.byteLength < s;
          let D2 = F2;
          switch (A2.name) {
            case "argon2":
            case "scrypt":
              D2 = () => true;
              break;
            case "blake2b":
            case "blake2s":
              D2 = (A3, I2) => I2 <= 512 && F2(A3);
              break;
            case "blake3":
              D2 = (A3, I2) => 0 === I2 && F2(A3);
              break;
            case "xxhash64":
            case "xxhash3":
            case "xxhash128":
            case "crc64":
              D2 = () => false;
          }
          return yield (() => I(this, void 0, void 0, function* () {
            g2 || (yield E2);
            const A3 = g2.exports.Hash_GetBuffer(), I2 = g2.exports.memory.buffer;
            C2 = new Uint8Array(I2, A3, s);
          }))(), { getMemory: () => C2, writeMemory: (A3, I2 = 0) => {
            C2.set(A3, I2);
          }, getExports: () => g2.exports, setMemorySize: (A3) => {
            g2.exports.Hash_SetMemorySize(A3);
            const I2 = g2.exports.Hash_GetBuffer(), i3 = g2.exports.memory.buffer;
            C2 = new Uint8Array(i3, I2, A3);
          }, init: e2, update: t2, digest: r2, save: () => {
            if (!B2) throw new Error("save() can only be called after init() and before digest()");
            const I2 = g2.exports.Hash_GetState(), i3 = Q2(), C3 = g2.exports.memory.buffer, E3 = new Uint8Array(C3, I2, i3), h2 = new Uint8Array(4 + i3);
            return w(h2, A2.hash), h2.set(E3, 4), h2;
          }, load: (I2) => {
            if (!(I2 instanceof Uint8Array)) throw new Error("load() expects an Uint8Array generated by save()");
            const i3 = g2.exports.Hash_GetState(), C3 = Q2(), E3 = 4 + C3, w2 = g2.exports.memory.buffer;
            if (I2.length !== E3) throw new Error(`Bad state length (expected ${E3} bytes, got ${I2.length})`);
            if (!(function(A3, I3) {
              if (A3.length !== 2 * I3.length) return false;
              for (let i4 = 0; i4 < I3.length; i4++) {
                const g3 = i4 << 1;
                if (I3[i4] !== h(A3.charCodeAt(g3), A3.charCodeAt(g3 + 1))) return false;
              }
              return true;
            })(A2.hash, I2.subarray(0, 4))) throw new Error("This state was written by an incompatible hash implementation");
            const e3 = I2.subarray(4);
            new Uint8Array(w2, i3, C3).set(e3), B2 = true;
          }, calculate: (A3, I2 = null, B3 = null) => {
            if (!D2(A3, I2)) return e2(I2), t2(A3), r2("hex", B3);
            const Q3 = n(A3);
            return C2.set(Q3), g2.exports.Hash_Calculate(Q3.length, I2, B3), o(f2, C2, i2);
          }, hashLength: i2 };
        });
      }
      var k = { name: "blake2b", data: "AGFzbQEAAAABEQRgAAF/YAJ/fwBgAX8AYAAAAwoJAAECAwECAgABBQQBAQICBg8CfwFBgIAEC38AQYCABAsHggEJBm1lbW9yeQIAD19fc3RhY2tfcG9pbnRlcgMADkhhc2hfR2V0QnVmZmVyAAAKSGFzaF9GaW5hbAADCUhhc2hfSW5pdAAFC0hhc2hfVXBkYXRlAAYNSGFzaF9HZXRTdGF0ZQAHDkhhc2hfQ2FsY3VsYXRlAAgKU1RBVEVfU0laRQMBCsU4CQYAQYCBBAvcAgIFfwF+AkAgAUEBSA0AAkAgAUGAAUEAKALgggUiAmsiA0wNAEEAQQA2AuCCBQJAIAJB/wBKDQAgAkHggQVqIQQgACEFQQAhBgNAIAQgBS0AADoAACAFQQFqIQUgBEEBaiEEIAMgBkEBaiIGQf8BcUoNAAsLQQBBACkDwIEFIgdCgAF8NwPAgQVBAEEAKQPIgQUgB0L/flatfDcDyIEFQeCBBRACIAAgA2ohAAJAIAEgA2siBEGBAU4NACAEIQEMAQsgAiABaiEEA0BBAEEAKQPAgQUiB0KAAXw3A8CBBUEAQQApA8iBBSAHQv9+Vq18NwPIgQUgABACIABBgAFqIQAgBEGAf2oiBEGAAksNAAsgBEGAf2ohAQtBACEEA0AgBEEAKALgggVqQeCBBWogACAEai0AADoAACABIARBAWoiBEH/AXFLDQALQQBBACgC4IIFIAFqNgLgggULC78uASR+QQBBACkD0IEFQQApA7CBBSIBQQApA5CBBXwgACkDICICfCIDhULr+obav7X2wR+FQiCJIgRCq/DT9K/uvLc8fCIFIAGFQiiJIgYgA3wgACkDKCIBfCIHIASFQjCJIgggBXwiCSAGhUIBiSIKQQApA8iBBUEAKQOogQUiBEEAKQOIgQV8IAApAxAiA3wiBYVCn9j52cKR2oKbf4VCIIkiC0K7zqqm2NDrs7t/fCIMIASFQiiJIg0gBXwgACkDGCIEfCIOfCAAKQNQIgV8Ig9BACkDwIEFQQApA6CBBSIQQQApA4CBBSIRfCAAKQMAIgZ8IhKFQtGFmu/6z5SH0QCFQiCJIhNCiJLznf/M+YTqAHwiFCAQhUIoiSIVIBJ8IAApAwgiEHwiFiAThUIwiSIXhUIgiSIYQQApA9iBBUEAKQO4gQUiE0EAKQOYgQV8IAApAzAiEnwiGYVC+cL4m5Gjs/DbAIVCIIkiGkLx7fT4paf9p6V/fCIbIBOFQiiJIhwgGXwgACkDOCITfCIZIBqFQjCJIhogG3wiG3wiHSAKhUIoiSIeIA98IAApA1giCnwiDyAYhUIwiSIYIB18Ih0gDiALhUIwiSIOIAx8Ih8gDYVCAYkiDCAWfCAAKQNAIgt8Ig0gGoVCIIkiFiAJfCIaIAyFQiiJIiAgDXwgACkDSCIJfCIhIBaFQjCJIhYgGyAchUIBiSIMIAd8IAApA2AiB3wiDSAOhUIgiSIOIBcgFHwiFHwiFyAMhUIoiSIbIA18IAApA2giDHwiHCAOhUIwiSIOIBd8IhcgG4VCAYkiGyAZIBQgFYVCAYkiFHwgACkDcCINfCIVIAiFQiCJIhkgH3wiHyAUhUIoiSIUIBV8IAApA3giCHwiFXwgDHwiIoVCIIkiI3wiJCAbhUIoiSIbICJ8IBJ8IiIgFyAYIBUgGYVCMIkiFSAffCIZIBSFQgGJIhQgIXwgDXwiH4VCIIkiGHwiFyAUhUIoiSIUIB98IAV8Ih8gGIVCMIkiGCAXfCIXIBSFQgGJIhR8IAF8IiEgFiAafCIWIBUgHSAehUIBiSIaIBx8IAl8IhyFQiCJIhV8Ih0gGoVCKIkiGiAcfCAIfCIcIBWFQjCJIhWFQiCJIh4gGSAOIBYgIIVCAYkiFiAPfCACfCIPhUIgiSIOfCIZIBaFQiiJIhYgD3wgC3wiDyAOhUIwiSIOIBl8Ihl8IiAgFIVCKIkiFCAhfCAEfCIhIB6FQjCJIh4gIHwiICAiICOFQjCJIiIgJHwiIyAbhUIBiSIbIBx8IAp8IhwgDoVCIIkiDiAXfCIXIBuFQiiJIhsgHHwgE3wiHCAOhUIwiSIOIBkgFoVCAYkiFiAffCAQfCIZICKFQiCJIh8gFSAdfCIVfCIdIBaFQiiJIhYgGXwgB3wiGSAfhUIwiSIfIB18Ih0gFoVCAYkiFiAVIBqFQgGJIhUgD3wgBnwiDyAYhUIgiSIYICN8IhogFYVCKIkiFSAPfCADfCIPfCAHfCIihUIgiSIjfCIkIBaFQiiJIhYgInwgBnwiIiAjhUIwiSIjICR8IiQgFoVCAYkiFiAOIBd8Ig4gDyAYhUIwiSIPICAgFIVCAYkiFCAZfCAKfCIXhUIgiSIYfCIZIBSFQiiJIhQgF3wgC3wiF3wgBXwiICAPIBp8Ig8gHyAOIBuFQgGJIg4gIXwgCHwiGoVCIIkiG3wiHyAOhUIoiSIOIBp8IAx8IhogG4VCMIkiG4VCIIkiISAdIB4gDyAVhUIBiSIPIBx8IAF8IhWFQiCJIhx8Ih0gD4VCKIkiDyAVfCADfCIVIByFQjCJIhwgHXwiHXwiHiAWhUIoiSIWICB8IA18IiAgIYVCMIkiISAefCIeIBogFyAYhUIwiSIXIBl8IhggFIVCAYkiFHwgCXwiGSAchUIgiSIaICR8IhwgFIVCKIkiFCAZfCACfCIZIBqFQjCJIhogHSAPhUIBiSIPICJ8IAR8Ih0gF4VCIIkiFyAbIB98Iht8Ih8gD4VCKIkiDyAdfCASfCIdIBeFQjCJIhcgH3wiHyAPhUIBiSIPIBsgDoVCAYkiDiAVfCATfCIVICOFQiCJIhsgGHwiGCAOhUIoiSIOIBV8IBB8IhV8IAx8IiKFQiCJIiN8IiQgD4VCKIkiDyAifCAHfCIiICOFQjCJIiMgJHwiJCAPhUIBiSIPIBogHHwiGiAVIBuFQjCJIhUgHiAWhUIBiSIWIB18IAR8IhuFQiCJIhx8Ih0gFoVCKIkiFiAbfCAQfCIbfCABfCIeIBUgGHwiFSAXIBogFIVCAYkiFCAgfCATfCIYhUIgiSIXfCIaIBSFQiiJIhQgGHwgCXwiGCAXhUIwiSIXhUIgiSIgIB8gISAVIA6FQgGJIg4gGXwgCnwiFYVCIIkiGXwiHyAOhUIoiSIOIBV8IA18IhUgGYVCMIkiGSAffCIffCIhIA+FQiiJIg8gHnwgBXwiHiAghUIwiSIgICF8IiEgGyAchUIwiSIbIB18IhwgFoVCAYkiFiAYfCADfCIYIBmFQiCJIhkgJHwiHSAWhUIoiSIWIBh8IBJ8IhggGYVCMIkiGSAfIA6FQgGJIg4gInwgAnwiHyAbhUIgiSIbIBcgGnwiF3wiGiAOhUIoiSIOIB98IAZ8Ih8gG4VCMIkiGyAafCIaIA6FQgGJIg4gFSAXIBSFQgGJIhR8IAh8IhUgI4VCIIkiFyAcfCIcIBSFQiiJIhQgFXwgC3wiFXwgBXwiIoVCIIkiI3wiJCAOhUIoiSIOICJ8IAh8IiIgGiAgIBUgF4VCMIkiFSAcfCIXIBSFQgGJIhQgGHwgCXwiGIVCIIkiHHwiGiAUhUIoiSIUIBh8IAZ8IhggHIVCMIkiHCAafCIaIBSFQgGJIhR8IAR8IiAgGSAdfCIZIBUgISAPhUIBiSIPIB98IAN8Ih2FQiCJIhV8Ih8gD4VCKIkiDyAdfCACfCIdIBWFQjCJIhWFQiCJIiEgFyAbIBkgFoVCAYkiFiAefCABfCIZhUIgiSIbfCIXIBaFQiiJIhYgGXwgE3wiGSAbhUIwiSIbIBd8Ihd8Ih4gFIVCKIkiFCAgfCAMfCIgICGFQjCJIiEgHnwiHiAiICOFQjCJIiIgJHwiIyAOhUIBiSIOIB18IBJ8Ih0gG4VCIIkiGyAafCIaIA6FQiiJIg4gHXwgC3wiHSAbhUIwiSIbIBcgFoVCAYkiFiAYfCANfCIXICKFQiCJIhggFSAffCIVfCIfIBaFQiiJIhYgF3wgEHwiFyAYhUIwiSIYIB98Ih8gFoVCAYkiFiAVIA+FQgGJIg8gGXwgCnwiFSAchUIgiSIZICN8IhwgD4VCKIkiDyAVfCAHfCIVfCASfCIihUIgiSIjfCIkIBaFQiiJIhYgInwgBXwiIiAjhUIwiSIjICR8IiQgFoVCAYkiFiAbIBp8IhogFSAZhUIwiSIVIB4gFIVCAYkiFCAXfCADfCIXhUIgiSIZfCIbIBSFQiiJIhQgF3wgB3wiF3wgAnwiHiAVIBx8IhUgGCAaIA6FQgGJIg4gIHwgC3wiGoVCIIkiGHwiHCAOhUIoiSIOIBp8IAR8IhogGIVCMIkiGIVCIIkiICAfICEgFSAPhUIBiSIPIB18IAZ8IhWFQiCJIh18Ih8gD4VCKIkiDyAVfCAKfCIVIB2FQjCJIh0gH3wiH3wiISAWhUIoiSIWIB58IAx8Ih4gIIVCMIkiICAhfCIhIBogFyAZhUIwiSIXIBt8IhkgFIVCAYkiFHwgEHwiGiAdhUIgiSIbICR8Ih0gFIVCKIkiFCAafCAJfCIaIBuFQjCJIhsgHyAPhUIBiSIPICJ8IBN8Ih8gF4VCIIkiFyAYIBx8Ihh8IhwgD4VCKIkiDyAffCABfCIfIBeFQjCJIhcgHHwiHCAPhUIBiSIPIBggDoVCAYkiDiAVfCAIfCIVICOFQiCJIhggGXwiGSAOhUIoiSIOIBV8IA18IhV8IA18IiKFQiCJIiN8IiQgD4VCKIkiDyAifCAMfCIiICOFQjCJIiMgJHwiJCAPhUIBiSIPIBsgHXwiGyAVIBiFQjCJIhUgISAWhUIBiSIWIB98IBB8IhiFQiCJIh18Ih8gFoVCKIkiFiAYfCAIfCIYfCASfCIhIBUgGXwiFSAXIBsgFIVCAYkiFCAefCAHfCIZhUIgiSIXfCIbIBSFQiiJIhQgGXwgAXwiGSAXhUIwiSIXhUIgiSIeIBwgICAVIA6FQgGJIg4gGnwgAnwiFYVCIIkiGnwiHCAOhUIoiSIOIBV8IAV8IhUgGoVCMIkiGiAcfCIcfCIgIA+FQiiJIg8gIXwgBHwiISAehUIwiSIeICB8IiAgGCAdhUIwiSIYIB98Ih0gFoVCAYkiFiAZfCAGfCIZIBqFQiCJIhogJHwiHyAWhUIoiSIWIBl8IBN8IhkgGoVCMIkiGiAcIA6FQgGJIg4gInwgCXwiHCAYhUIgiSIYIBcgG3wiF3wiGyAOhUIoiSIOIBx8IAN8IhwgGIVCMIkiGCAbfCIbIA6FQgGJIg4gFSAXIBSFQgGJIhR8IAt8IhUgI4VCIIkiFyAdfCIdIBSFQiiJIhQgFXwgCnwiFXwgBHwiIoVCIIkiI3wiJCAOhUIoiSIOICJ8IAl8IiIgGyAeIBUgF4VCMIkiFSAdfCIXIBSFQgGJIhQgGXwgDHwiGYVCIIkiHXwiGyAUhUIoiSIUIBl8IAp8IhkgHYVCMIkiHSAbfCIbIBSFQgGJIhR8IAN8Ih4gGiAffCIaIBUgICAPhUIBiSIPIBx8IAd8IhyFQiCJIhV8Ih8gD4VCKIkiDyAcfCAQfCIcIBWFQjCJIhWFQiCJIiAgFyAYIBogFoVCAYkiFiAhfCATfCIahUIgiSIYfCIXIBaFQiiJIhYgGnwgDXwiGiAYhUIwiSIYIBd8Ihd8IiEgFIVCKIkiFCAefCAFfCIeICCFQjCJIiAgIXwiISAiICOFQjCJIiIgJHwiIyAOhUIBiSIOIBx8IAt8IhwgGIVCIIkiGCAbfCIbIA6FQiiJIg4gHHwgEnwiHCAYhUIwiSIYIBcgFoVCAYkiFiAZfCABfCIXICKFQiCJIhkgFSAffCIVfCIfIBaFQiiJIhYgF3wgBnwiFyAZhUIwiSIZIB98Ih8gFoVCAYkiFiAVIA+FQgGJIg8gGnwgCHwiFSAdhUIgiSIaICN8Ih0gD4VCKIkiDyAVfCACfCIVfCANfCIihUIgiSIjfCIkIBaFQiiJIhYgInwgCXwiIiAjhUIwiSIjICR8IiQgFoVCAYkiFiAYIBt8IhggFSAahUIwiSIVICEgFIVCAYkiFCAXfCASfCIXhUIgiSIafCIbIBSFQiiJIhQgF3wgCHwiF3wgB3wiISAVIB18IhUgGSAYIA6FQgGJIg4gHnwgBnwiGIVCIIkiGXwiHSAOhUIoiSIOIBh8IAt8IhggGYVCMIkiGYVCIIkiHiAfICAgFSAPhUIBiSIPIBx8IAp8IhWFQiCJIhx8Ih8gD4VCKIkiDyAVfCAEfCIVIByFQjCJIhwgH3wiH3wiICAWhUIoiSIWICF8IAN8IiEgHoVCMIkiHiAgfCIgIBggFyAahUIwiSIXIBt8IhogFIVCAYkiFHwgBXwiGCAchUIgiSIbICR8IhwgFIVCKIkiFCAYfCABfCIYIBuFQjCJIhsgHyAPhUIBiSIPICJ8IAx8Ih8gF4VCIIkiFyAZIB18Ihl8Ih0gD4VCKIkiDyAffCATfCIfIBeFQjCJIhcgHXwiHSAPhUIBiSIPIBkgDoVCAYkiDiAVfCAQfCIVICOFQiCJIhkgGnwiGiAOhUIoiSIOIBV8IAJ8IhV8IBN8IiKFQiCJIiN8IiQgD4VCKIkiDyAifCASfCIiICOFQjCJIiMgJHwiJCAPhUIBiSIPIBsgHHwiGyAVIBmFQjCJIhUgICAWhUIBiSIWIB98IAt8IhmFQiCJIhx8Ih8gFoVCKIkiFiAZfCACfCIZfCAJfCIgIBUgGnwiFSAXIBsgFIVCAYkiFCAhfCAFfCIahUIgiSIXfCIbIBSFQiiJIhQgGnwgA3wiGiAXhUIwiSIXhUIgiSIhIB0gHiAVIA6FQgGJIg4gGHwgEHwiFYVCIIkiGHwiHSAOhUIoiSIOIBV8IAF8IhUgGIVCMIkiGCAdfCIdfCIeIA+FQiiJIg8gIHwgDXwiICAhhUIwiSIhIB58Ih4gGSAchUIwiSIZIB98IhwgFoVCAYkiFiAafCAIfCIaIBiFQiCJIhggJHwiHyAWhUIoiSIWIBp8IAp8IhogGIVCMIkiGCAdIA6FQgGJIg4gInwgBHwiHSAZhUIgiSIZIBcgG3wiF3wiGyAOhUIoiSIOIB18IAd8Ih0gGYVCMIkiGSAbfCIbIA6FQgGJIg4gFSAXIBSFQgGJIhR8IAx8IhUgI4VCIIkiFyAcfCIcIBSFQiiJIhQgFXwgBnwiFXwgEnwiIoVCIIkiI3wiJCAOhUIoiSIOICJ8IBN8IiIgGyAhIBUgF4VCMIkiFSAcfCIXIBSFQgGJIhQgGnwgBnwiGoVCIIkiHHwiGyAUhUIoiSIUIBp8IBB8IhogHIVCMIkiHCAbfCIbIBSFQgGJIhR8IA18IiEgGCAffCIYIBUgHiAPhUIBiSIPIB18IAJ8Ih2FQiCJIhV8Ih4gD4VCKIkiDyAdfCABfCIdIBWFQjCJIhWFQiCJIh8gFyAZIBggFoVCAYkiFiAgfCADfCIYhUIgiSIZfCIXIBaFQiiJIhYgGHwgBHwiGCAZhUIwiSIZIBd8Ihd8IiAgFIVCKIkiFCAhfCAIfCIhIB+FQjCJIh8gIHwiICAiICOFQjCJIiIgJHwiIyAOhUIBiSIOIB18IAd8Ih0gGYVCIIkiGSAbfCIbIA6FQiiJIg4gHXwgDHwiHSAZhUIwiSIZIBcgFoVCAYkiFiAafCALfCIXICKFQiCJIhogFSAefCIVfCIeIBaFQiiJIhYgF3wgCXwiFyAahUIwiSIaIB58Ih4gFoVCAYkiFiAVIA+FQgGJIg8gGHwgBXwiFSAchUIgiSIYICN8IhwgD4VCKIkiDyAVfCAKfCIVfCACfCIChUIgiSIifCIjIBaFQiiJIhYgAnwgC3wiAiAihUIwiSILICN8IiIgFoVCAYkiFiAZIBt8IhkgFSAYhUIwiSIVICAgFIVCAYkiFCAXfCANfCINhUIgiSIXfCIYIBSFQiiJIhQgDXwgBXwiBXwgEHwiECAVIBx8Ig0gGiAZIA6FQgGJIg4gIXwgDHwiDIVCIIkiFXwiGSAOhUIoiSIOIAx8IBJ8IhIgFYVCMIkiDIVCIIkiFSAeIB8gDSAPhUIBiSINIB18IAl8IgmFQiCJIg98IhogDYVCKIkiDSAJfCAIfCIJIA+FQjCJIgggGnwiD3wiGiAWhUIoiSIWIBB8IAd8IhAgEYUgDCAZfCIHIA6FQgGJIgwgCXwgCnwiCiALhUIgiSILIAUgF4VCMIkiBSAYfCIJfCIOIAyFQiiJIgwgCnwgE3wiEyALhUIwiSIKIA58IguFNwOAgQVBACADIAYgDyANhUIBiSINIAJ8fCICIAWFQiCJIgUgB3wiBiANhUIoiSIHIAJ8fCICQQApA4iBBYUgBCABIBIgCSAUhUIBiSIDfHwiASAIhUIgiSISICJ8IgkgA4VCKIkiAyABfHwiASAShUIwiSIEIAl8IhKFNwOIgQVBACATQQApA5CBBYUgECAVhUIwiSIQIBp8IhOFNwOQgQVBACABQQApA5iBBYUgAiAFhUIwiSICIAZ8IgGFNwOYgQVBACASIAOFQgGJQQApA6CBBYUgAoU3A6CBBUEAIBMgFoVCAYlBACkDqIEFhSAKhTcDqIEFQQAgASAHhUIBiUEAKQOwgQWFIASFNwOwgQVBACALIAyFQgGJQQApA7iBBYUgEIU3A7iBBQveAgUBfwF+AX8BfgJ/IwBBwABrIgAkAAJAQQApA9CBBUIAUg0AQQBBACkDwIEFIgFBACgC4IIFIgKsfCIDNwPAgQVBAEEAKQPIgQUgAyABVK18NwPIgQUCQEEALQDoggVFDQBBAEJ/NwPYgQULQQBCfzcD0IEFAkAgAkH/AEoNAEEAIQQDQCACIARqQeCBBWpBADoAACAEQQFqIgRBgAFBACgC4IIFIgJrSA0ACwtB4IEFEAIgAEEAKQOAgQU3AwAgAEEAKQOIgQU3AwggAEEAKQOQgQU3AxAgAEEAKQOYgQU3AxggAEEAKQOggQU3AyAgAEEAKQOogQU3AyggAEEAKQOwgQU3AzAgAEEAKQO4gQU3AzhBACgC5IIFIgVBAUgNAEEAIQJBACEEA0AgBEGAgQRqIAAgBGotAAA6AAAgBEEBaiEEIAUgAkEBaiICQf8BcUsNAAsLIABBwABqJAAL+gMCAn8BfiMAQYABayICJABBAEGBAjsB8oIFQQAgAToA8YIFQQAgADoA8IIFQZB+IQADQCAAQYCDBWpCADcAACAAQfiCBWpCADcAACAAQfCCBWpCADcAACAAQRhqIgANAAtBACEDQQBBACkD8IIFIgRCiJLznf/M+YTqAIU3A4CBBUEAQQApA/iCBUK7zqqm2NDrs7t/hTcDiIEFQQBBACkDgIMFQqvw0/Sv7ry3PIU3A5CBBUEAQQApA4iDBULx7fT4paf9p6V/hTcDmIEFQQBBACkDkIMFQtGFmu/6z5SH0QCFNwOggQVBAEEAKQOYgwVCn9j52cKR2oKbf4U3A6iBBUEAQQApA6CDBULr+obav7X2wR+FNwOwgQVBAEEAKQOogwVC+cL4m5Gjs/DbAIU3A7iBBUEAIASnQf8BcTYC5IIFAkAgAUUNACACQgA3A3ggAkIANwNwIAJCADcDaCACQgA3A2AgAkIANwNYIAJCADcDUCACQgA3A0ggAkIANwNAIAJCADcDOCACQgA3AzAgAkIANwMoIAJCADcDICACQgA3AxggAkIANwMQIAJCADcDCCACQgA3AwBBACEAA0AgAiAAaiAAQYCBBGotAAA6AAAgAEEBaiEAIAEgA0EBaiIDQf8BcUsNAAsgAkGAARABCyACQYABaiQACxIAIABBA3ZB/z9xIABBEHYQBAsKAEGAgQQgABABCwYAQYCBBQscACABQQN2Qf8/cSABQRB2EARBgIEEIAAQARADCwsMAQBBgIAECwTwAAAA", hash: "22cf500a" };
      function G(A2) {
        return !Number.isInteger(A2) || A2 < 8 || A2 > 512 || A2 % 8 != 0 ? new Error("Invalid variant! Valid values: 8, 16, ..., 512") : null;
      }
      function p(A2 = 512, I2 = null) {
        if (G(A2)) return Promise.reject(G(A2));
        let i2 = null, g2 = A2;
        if (null !== I2) {
          if (i2 = n(I2), i2.length > 64) return Promise.reject(new Error("Max key length is 64 bytes"));
          C2 = A2, B2 = i2.length, g2 = C2 | B2 << 16;
        }
        var C2, B2;
        const Q2 = A2 / 8;
        return c(k, Q2).then((A3) => {
          g2 > 512 && A3.writeMemory(i2), A3.init(g2);
          const I3 = { init: g2 > 512 ? () => (A3.writeMemory(i2), A3.init(g2), I3) : () => (A3.init(g2), I3), update: (i3) => (A3.update(i3), I3), digest: (I4) => A3.digest(I4), save: () => A3.save(), load: (i3) => (A3.load(i3), I3), blockSize: 128, digestSize: Q2 };
          return I3;
        });
      }
      new C();
      const y = new DataView(new ArrayBuffer(4));
      function H(A2) {
        return y.setInt32(0, A2, true), new Uint8Array(y.buffer);
      }
      function u(A2, i2, g2) {
        return I(this, void 0, void 0, function* () {
          if (g2 <= 64) {
            const A3 = yield p(8 * g2);
            return A3.update(H(g2)), A3.update(i2), A3.digest("binary");
          }
          const I2 = Math.ceil(g2 / 32) - 2, C2 = new Uint8Array(g2);
          A2.init(), A2.update(H(g2)), A2.update(i2);
          let B2 = A2.digest("binary");
          C2.set(B2.subarray(0, 32), 0);
          for (let i3 = 1; i3 < I2; i3++) A2.init(), A2.update(B2), B2 = A2.digest("binary"), C2.set(B2.subarray(0, 32), 32 * i3);
          const Q2 = g2 - 32 * I2;
          let E2;
          return 64 === Q2 ? (E2 = A2, E2.init()) : E2 = yield p(8 * Q2), E2.update(B2), B2 = E2.digest("binary"), C2.set(B2.subarray(0, Q2), 32 * I2), C2;
        });
      }
      function Y(A2) {
        return I(this, void 0, void 0, function* () {
          var I2;
          const { parallelism: i2, iterations: C2, hashLength: B2 } = A2, Q2 = n(A2.password), E2 = n(A2.salt), h2 = (function(A3) {
            switch (A3) {
              case "d":
                return 0;
              case "i":
                return 1;
              default:
                return 2;
            }
          })(A2.hashType), { memorySize: e2 } = A2, t2 = n(null !== (I2 = A2.secret) && void 0 !== I2 ? I2 : ""), [f2, r2] = yield Promise.all([c(g, 1024), p(512)]);
          f2.setMemorySize(1024 * e2 + 1024);
          const D2 = new Uint8Array(24), a2 = new DataView(D2.buffer);
          a2.setInt32(0, i2, true), a2.setInt32(4, B2, true), a2.setInt32(8, e2, true), a2.setInt32(12, C2, true), a2.setInt32(16, 19, true), a2.setInt32(20, h2, true), f2.writeMemory(D2, 1024 * e2), r2.init(), r2.update(D2), r2.update(H(Q2.length)), r2.update(Q2), r2.update(H(E2.length)), r2.update(E2), r2.update(H(t2.length)), r2.update(t2), r2.update(H(0));
          const s2 = 4 * Math.floor(e2 / (4 * i2)), U2 = new Uint8Array(72), S2 = r2.digest("binary");
          U2.set(S2);
          for (let A3 = 0; A3 < i2; A3++) {
            U2.set(H(0), 64), U2.set(H(A3), 68);
            let I3 = A3 * s2, i3 = yield u(r2, U2, 1024);
            f2.writeMemory(i3, 1024 * I3), I3 += 1, U2.set(H(1), 64), i3 = yield u(r2, U2, 1024), f2.writeMemory(i3, 1024 * I3);
          }
          const k2 = new Uint8Array(1024);
          w(k2, f2.calculate(new Uint8Array([]), e2));
          const G2 = yield u(r2, k2, B2);
          if ("hex" === A2.outputType) {
            return o(new Uint8Array(2 * B2), G2, B2);
          }
          return "encoded" === A2.outputType ? (function(A3, I3, i3) {
            const g2 = [`m=${I3.memorySize}`, `t=${I3.iterations}`, `p=${I3.parallelism}`].join(",");
            return `$argon2${I3.hashType}$v=19$${g2}$${F(A3, false)}$${F(i3, false)}`;
          })(E2, A2, G2) : G2;
        });
      }
      const V = (A2) => {
        var I2;
        if (!A2 || "object" != typeof A2) throw new Error("Invalid options parameter. It requires an object.");
        if (!A2.password) throw new Error("Password must be specified");
        if (A2.password = n(A2.password), A2.password.length < 1) throw new Error("Password must be specified");
        if (!A2.salt) throw new Error("Salt must be specified");
        if (A2.salt = n(A2.salt), A2.salt.length < 8) throw new Error("Salt should be at least 8 bytes long");
        if (A2.secret = n(null !== (I2 = A2.secret) && void 0 !== I2 ? I2 : ""), !Number.isInteger(A2.iterations) || A2.iterations < 1) throw new Error("Iterations should be a positive number");
        if (!Number.isInteger(A2.parallelism) || A2.parallelism < 1) throw new Error("Parallelism should be a positive number");
        if (!Number.isInteger(A2.hashLength) || A2.hashLength < 4) throw new Error("Hash length should be at least 4 bytes.");
        if (!Number.isInteger(A2.memorySize)) throw new Error("Memory size should be specified.");
        if (A2.memorySize < 8 * A2.parallelism) throw new Error("Memory size should be at least 8 * parallelism.");
        if (void 0 === A2.outputType && (A2.outputType = "hex"), !["hex", "binary", "encoded"].includes(A2.outputType)) throw new Error(`Insupported output type ${A2.outputType}. Valid values: ['hex', 'binary', 'encoded']`);
      };
      A.argon2Verify = function(A2) {
        return I(this, void 0, void 0, function* () {
          ((A3) => {
            if (!A3 || "object" != typeof A3) throw new Error("Invalid options parameter. It requires an object.");
            if (void 0 === A3.hash || "string" != typeof A3.hash) throw new Error("Hash should be specified");
          })(A2);
          const I2 = ((A3, I3, i3) => {
            const g2 = I3.match(/^\$argon2(id|i|d)\$v=([0-9]+)\$((?:[mtp]=[0-9]+,){2}[mtp]=[0-9]+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/);
            if (!g2) throw new Error("Invalid hash");
            const [, C2, B2, Q2, E2, h2] = g2;
            if ("19" !== B2) throw new Error(`Unsupported version: ${B2}`);
            const w2 = {}, e2 = { m: "memorySize", p: "parallelism", t: "iterations" };
            for (const A4 of Q2.split(",")) {
              const [I4, i4] = A4.split("=");
              w2[e2[I4]] = Number(i4);
            }
            return Object.assign(Object.assign({}, w2), { password: A3, secret: i3, hashType: C2, salt: a(E2), hashLength: D(h2), outputType: "encoded" });
          })(A2.password, A2.hash, A2.secret);
          V(I2);
          const i2 = A2.hash.lastIndexOf("$") + 1;
          return (yield Y(I2)).substring(i2) === A2.hash.substring(i2);
        });
      }, A.argon2d = function(A2) {
        return I(this, void 0, void 0, function* () {
          return V(A2), Y(Object.assign(Object.assign({}, A2), { hashType: "d" }));
        });
      }, A.argon2i = function(A2) {
        return I(this, void 0, void 0, function* () {
          return V(A2), Y(Object.assign(Object.assign({}, A2), { hashType: "i" }));
        });
      }, A.argon2id = function(A2) {
        return I(this, void 0, void 0, function* () {
          return V(A2), Y(Object.assign(Object.assign({}, A2), { hashType: "id" }));
        });
      };
    });
  }
});
export default require_argon2_umd_min();
/*! Bundled license information:

hash-wasm/dist/argon2.umd.min.js:
  (*!
   * hash-wasm (https://www.npmjs.com/package/hash-wasm)
   * (c) Dani Biro
   * @license MIT
   *)
*/
