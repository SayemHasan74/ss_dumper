import { useEffect, useRef, useState } from 'preact/hooks';
import type { FileDTO } from '../../../shared/types';
import { authState } from '../auth';
import { showToast } from '../store/ui';
import { textPreviewable } from '../lib/file-type';

export function TextPreview({file}:{file:FileDTO}) {
  const [text,setText]=useState<string|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
  useEffect(()=>{setText(null);setError('');setLoading(false);},[file.id]);
  const controller=useRef<AbortController|undefined>(undefined);
  useEffect(()=>()=>controller.current?.abort(),[file.id]);
  if(!textPreviewable(file.name))return null;
  if(file.size>256*1024)return <p>Download to view this file. Source preview is limited to 256 KiB.</p>;
  async function load():Promise<void>{
    controller.current?.abort();const request=new AbortController();controller.current=request;setLoading(true);setError('');
    try{const response=await fetch(`/api/files/${file.id}/original`,{credentials:'same-origin',signal:request.signal});if(response.status===401){authState.value='out';return;}if(!response.ok)throw new Error('unavailable');const bytes=await response.arrayBuffer();if(bytes.byteLength>256*1024)throw new Error('size');const value=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(value.includes('\0'))throw new Error('binary');if(!request.signal.aborted)setText(value);}
    catch{if(!request.signal.aborted)setError('Preview unavailable. Download to open this file locally.');}
    finally{if(!request.signal.aborted)setLoading(false);}
  }
  return <section class="file-source"><p class="source-hint">Source text only. HTML, scripts and Markdown are never executed.</p>{text===null?<button class="viewer-button secondary" disabled={loading} onClick={()=>void load()}>{loading?'Loading source…':error?'Retry source preview':'Preview source'}</button>:<><pre class="source-preview" tabIndex={0} aria-label={`Source of ${file.name}`}>{text}</pre><button class="viewer-button secondary" onClick={()=>{if(!navigator.clipboard?.writeText){showToast('Select the source text to copy it.');return;}void navigator.clipboard.writeText(text).then(()=>showToast('Text copied.')).catch(()=>showToast('Select the source text to copy it.',undefined,true));}}>Copy text</button></>}{error&&<p role="status">{error}</p>}</section>;
}
