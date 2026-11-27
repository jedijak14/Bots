import assert from 'node:assert/strict';
import { parseLyricUploadRequest } from '../src/lib/lyric-upload-request';
const audio='a88b7659-ec03-43d4-b4a8-fdd59b267bc1', lyrics='a88b7659-ec03-43d4-b4a8-fdd59b267bc2', art='a88b7659-ec03-43d4-b4a8-fdd59b267bc3';
const draft=`Make a lyric video from my uploads. Title: Fingerprints, artist Dan Bremnes.\nAudio artifact id: ${audio}\nCover art artifact id: ${art}\nLyrics artifact id: ${lyrics} (lrc)`;
{
  assert.deepEqual(parseLyricUploadRequest(draft), {title:'Fingerprints', artist:'Dan Bremnes', audioId:audio, artId:art, lyricsId:lyrics, lyricFormat:'lrc'});
  assert.deepEqual(parseLyricUploadRequest(`Make a lyric video from my uploads. Title: Song.\nAudio artifact id: ${audio}\nLyrics artifact id: ${lyrics} (plain)`), {title:'Song',audioId:audio,lyricsId:lyrics,lyricFormat:'plain'});
  assert.equal(parseLyricUploadRequest(draft+'\nAlso write a poem.'), null);
  assert.equal(parseLyricUploadRequest(draft.replace(audio, 'bad-id')), null);
  assert.equal(parseLyricUploadRequest(draft.replace('(lrc)', '(nope)')), null);
  assert.equal(parseLyricUploadRequest('Please make a lyric video'), null);
}
