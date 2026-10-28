import test from 'node:test';
import assert from 'node:assert/strict';
import {describeTranscriptionError} from './transcription-messages';

test('a missing speech model is explained without file names or environment variables, and points to Settings',()=>{
 const notice=describeTranscriptionError('Set the local Whisper GGML model path in AI settings, or SCENEFORGE_WHISPER_MODEL.')!;
 assert.equal(notice.title,'Captions are not set up yet');
 assert.equal(notice.retryHelps,false);
 assert.equal(notice.setup,true);
 assert.doesNotMatch(notice.message,/GGML|CREATOR COMPILER|path/i);
 assert.match(notice.message,/still work/);
 assert.match(notice.message,/OpenRouter/,'the quickest fix is named');
 assert.deepEqual(describeTranscriptionError('Local Whisper model file is missing. Set a valid GGML model path in AI settings.'),notice);
});

test('missing tools and silent clips cannot be fixed by retrying',()=>{
 assert.equal(describeTranscriptionError('Local whisper-cli is not installed or its executable path is invalid.')!.retryHelps,false);
 assert.equal(describeTranscriptionError('FFmpeg is required to prepare audio for transcription.')!.retryHelps,false);
 assert.equal(describeTranscriptionError('This media has no audio track.')!.title,'Nothing to transcribe');
});

test('an unknown failure keeps its own message and may be retried; no message means no notice',()=>{
 const notice=describeTranscriptionError('The provider timed out.')!;
 assert.equal(notice.message,'The provider timed out.');
 assert.equal(notice.retryHelps,true);
 assert.equal(describeTranscriptionError(''),null);
 assert.equal(describeTranscriptionError(undefined),null);
});
