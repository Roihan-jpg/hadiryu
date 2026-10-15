import { describe, expect, it } from 'vitest';
import { faceMatches } from './simple-face.js';

describe('recognition decisions',()=>{
  const face=Array.from({length:128},(_,index)=>index===0?1:0);
  it('accepts the same embedding and rejects an unrelated identity',()=>{
    expect(faceMatches(face,[...face])).toBe(true);
    expect(faceMatches(face,face.map((_,index)=>index===1?1:0))).toBe(false);
  });
  it('rejects malformed or non-normalized outputs instead of silently matching',()=>{
    for(const invalid of [[],Array(128).fill(0),Array(128).fill(1),[NaN,...face.slice(1)]]){
      expect(()=>faceMatches(face,invalid)).toThrow('Hasil pengenalan wajah tidak valid');
    }
  });
});
