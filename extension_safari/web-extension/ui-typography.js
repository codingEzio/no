// Shared typography limits and controls. 0 preserves the host size/line height.
(() => {
  const fields=[['fontWeight',0,900,100,400],['lineHeight',0,3,.05,0],['fontSize',0,48,1,0],['letterSpacing',-.2,1,.01,0],['glyphHeight',105,120,5,110]];
  function normalize(input={}){return Object.fromEntries(fields.map(([key,min,max,step,fallback])=>{const n=Number(input[key]);return[key,input[key]!=null&&Number.isFinite(n)?(key==='fontWeight'&&n!==0?Math.max(100,Math.min(max,n)):Math.max(min,Math.min(max,n))):fallback];}));}
  function declarations(input={},variable=false){const t=normalize(input);return `${!variable||t.fontWeight>0?`font-weight:${variable?t.fontWeight:400}!important;`:""}${t.letterSpacing!==0?`letter-spacing:${t.letterSpacing}em!important;`:""}font-variation-settings:"HGHT" ${t.glyphHeight}!important;${t.lineHeight>0?`line-height:${t.lineHeight}!important;`:''}${t.fontSize>0?`font-size:${t.fontSize}px!important;`:''}`;}
  function mount(parent,initial,save,language='en'){
    let current=normalize(initial),busy=false;const controls=[];
    const labels=language.startsWith('zh')?/TW|HK|Hant|tw|hk/.test(language)?['字重','行高','內容字級','字距','Doto 字形高度']:['字重','行高','内容字号','字距','Doto 字形高度']:['Weight','Line height','Content size','Letter spacing','Doto glyph height'];
    for(const[index,[key,min,max,step]]of fields.entries()){
      const label=parent.ownerDocument.createElement('label'),input=parent.ownerDocument.createElement(key==='glyphHeight'?'select':'input'),output=parent.ownerDocument.createElement('output');label.textContent=labels[index];input.setAttribute('aria-label',labels[index]);input.dataset.typographyProperty=key;
      if(key==='glyphHeight')for(const n of[105,110,115,120]){const option=parent.ownerDocument.createElement('option');option.value=String(n);option.textContent=n+'%';input.append(option);}
      else{input.type='range';input.min=String(min);input.max=String(max);input.step=String(step);}
      input.value=String(current[key]);output.textContent=input.value;input.addEventListener('input',()=>output.textContent=input.value);
      input.addEventListener('change',async()=>{if(busy)return;busy=true;controls.forEach(c=>c.disabled=true);const before=current;try{current=normalize({...current,[key]:Number(input.value)});await save(current);label.title='';}catch(error){current=before;input.value=String(current[key]);output.textContent=input.value;label.title=String(error);}finally{busy=false;controls.forEach(c=>c.disabled=false);}});
      const reset=parent.ownerDocument.createElement('button');reset.type='button';reset.textContent=language.startsWith('zh')?(/TW|HK|Hant/i.test(language)?'預設':'默认'):'Default';reset.addEventListener('click',()=>{input.value=String(key==='glyphHeight'?110:0);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});label.append(input,output,reset);parent.append(label);controls.push(input,reset);
    }
    return controls;
  }
  globalThis.ExtensionTypographyGeometry=Object.freeze({normalize,declarations,mount});
})();

// One persisted final font choice, with independent system Mono/Emoji preferences.
(() => {
  const fonts = [{"id":"geist-pixel-square","key":"sansPixel","family":"GeistMixUI_NerdAndZhAndEmoji3D","file":"GeistMixUI_NerdAndZhAndEmoji3D.woff2","bytes":1552196,"sha256":"f47293da8758f8cb39402da67b00208a012b8287367b73063ec2f0db15a3408c","heightAxis":null,"weight":"400","role":"sans"},{"id":"geist-code","key":"monoGeist","family":"GeistMixCode_NerdAndZhAndEmoji3D","file":"GeistMixCode_NerdAndZhAndEmoji3D.woff2","bytes":1592320,"sha256":"906a78e49394149a9b85c71e3b6af19a50ef0ab1bc9d8da86006f77f15af0a0e","heightAxis":null,"weight":"100 900","role":"mono"},{"id":"doto-500","key":"doto500","family":"Doto500MixUI_NerdAndZhAndEmoji3D","file":"Doto500MixUI_NerdAndZhAndEmoji3D.woff2","bytes":1536968,"sha256":"b01a09cf6cf04bdea83eaaec005ae0ca4b02b9a1b433f7619698268be312c9f3","heightAxis":{"tag":"HGHT","values":[105,110,115,120],"default":110},"weight":"400","role":"doto-500"},{"id":"doto-700","key":"doto700","family":"Doto700MixUI_NerdAndZhAndEmoji3D","file":"Doto700MixUI_NerdAndZhAndEmoji3D.woff2","bytes":1537680,"sha256":"84cbd889d9e44a71db5ed1e1ce920a06ae87e8fa5557f735c1256a2cbb225c9c","heightAxis":{"tag":"HGHT","values":[105,110,115,120],"default":110},"weight":"400","role":"doto-700"},{"id":"doto-900","key":"doto900","family":"Doto900MixUI_NerdAndZhAndEmoji3D","file":"Doto900MixUI_NerdAndZhAndEmoji3D.woff2","bytes":1537596,"sha256":"7c06e9fe4f51cc0fee771554a5f55d2ebfae4f85522c57a9b09123a1f6785faf","heightAxis":{"tag":"HGHT","values":[105,110,115,120],"default":110},"weight":"400","role":"doto-900"},{"id":"departure","key":"departure","family":"DeparturePixelZh","file":"DeparturePixelZh-Regular.woff2","bytes":1390160,"sha256":"43b3d4dd811b376e360ce28275ab3e41d68b7e4f61dab60e44933608da62fe23","weight":"400","role":"departure"},{"id":"departure-compact","key":"departureCompact","family":"DeparturePixelZh Compact","file":"DeparturePixelZhCompact-Regular.woff2","bytes":1389344,"sha256":"2b46974c046bc8d9b1f4f195d5fe848ae17ebb41ed2a99f3784cb60ad65c13eb","weight":"400","role":"departure-compact"}];
  const geometryKey='extension.typography',fontKey='extension.uiFont',monoKey='extension.monoFont',emojiKey='extension.emojiFont';
  const storage=globalThis.browser?.storage?.local??globalThis.chrome?.storage?.local;
  if(!storage)return;
  const byId=new Map(fonts.map(f=>[f.id,f]));
  const normalizeFont=value=>value==='system'?'system':byId.has(value)?value:({compact:'departure-compact','doto-800':'doto-700','doto-900':'doto-900','doto-refined-500':'doto-500','doto-refined-800':'doto-700'}[value]??fonts[0].id);
  const mono=value=>value==='system'?'system':'geist';
  const emoji=value=>value==='noto3d'?'noto3d':'system';
  async function renderEmoji(mode){
    const renderer=globalThis.ExtensionBrowserEmoji;if(!renderer||!document.body)return;
    try{
      if(mode==='noto3d'){
        const runtime=globalThis.browser?.runtime??globalThis.chrome?.runtime;
        const url=runtime?.getURL?runtime.getURL('ui-fonts/browser/emoji-sequences.json'):new URL('ui-fonts/browser/emoji-sequences.json',document.baseURI).href;
        renderer.configure(await renderer.loadSequences(url));
      }
      renderer.apply(document.body,{mode:document.documentElement.dataset.extensionEmoji??'system'});
    }catch(error){document.documentElement.dataset.extensionEmojiError=String(error);}
  }
  function apply(saved){
    const root=document.documentElement,selected=byId.get(normalizeFont(saved[fontKey]))??{id:'system',family:'system-ui'};
    root.dataset.extensionFont=selected.id;root.dataset.extensionMono=mono(saved[monoKey]);root.dataset.extensionEmoji=emoji(saved[emojiKey]);
    root.style.setProperty('--ui-font',JSON.stringify(selected.family)+',system-ui,sans-serif');
    root.style.setProperty('--ui-mono',mono(saved[monoKey])==='system'?'ui-monospace,monospace':JSON.stringify(fonts[1].family)+',ui-monospace,monospace');
    const geometry=globalThis.ExtensionTypographyGeometry.normalize(saved[geometryKey]);
    let style=document.getElementById('extension-type-geometry');if(!style){style=document.createElement('style');style.id='extension-type-geometry';document.head.append(style);}
    style.textContent=`html[data-extension-font] :where(body,button,input,select,textarea,span,p,a,li,h1,h2,h3,h4,label,small):not(.calmly-emoji){${globalThis.ExtensionTypographyGeometry.declarations(geometry,selected.id==='geist-code')}}html[data-extension-font] :is(code,pre,kbd,samp){font-weight:${geometry.fontWeight}!important}`;
    void renderEmoji(emoji(saved[emojiKey]));
  }
  async function load(){
    let saved=await storage.get([fontKey,monoKey,emojiKey,geometryKey]);
    const normalized={[fontKey]:normalizeFont(saved[fontKey]),[monoKey]:mono(saved[monoKey]),[emojiKey]:emoji(saved[emojiKey])};
    if(Object.keys(normalized).some(key=>saved[key]!==normalized[key])){
      await storage.set(normalized);saved=await storage.get(Object.keys(normalized));
      if(Object.keys(normalized).some(key=>saved[key]!==normalized[key]))throw Error('Typography preference readback failed');
    }
    apply(saved);return saved;
  }
  const initial=load();initial.catch(error=>{document.documentElement.dataset.extensionTypographyError=String(error);});
  async function mount(){
    if(document.documentElement.dataset.typographyControls==='hidden')return;
    const language=globalThis.browser?.i18n?.getUILanguage?.()??globalThis.chrome?.i18n?.getUILanguage?.()??document.documentElement.lang??navigator.language;
    const zh=language.startsWith('zh'),traditional=/TW|HK|Hant/i.test(language);
    const labels=zh?traditional?['字型','等寬字型','表情符號','系統等寬','系統表情']:['字体','等宽字体','表情符号','系统等宽','系统表情']:['Font','Mono font','Emoji','System mono','System emoji'];
    const controls=document.createElement('span');controls.className='extension-font-controls';
    const entries=[[fontKey,labels[0],[['system',zh?(traditional?'預設 · 系統字型':'默认 · 系统字体'):'Default · system font'],...fonts.map(f=>[f.id,f.family])]],[monoKey,labels[1],[['geist',fonts[1].family],['system',labels[3]]]],[emojiKey,labels[2],[['system',labels[4]],['noto3d','Emoji3D']]]];
    const selects=[];
    for(const[key,label,choices]of entries){
      const select=document.createElement('select');select.className='extension-font-choice';select.setAttribute('aria-label',label);select.title=label;
      for(const[value,name]of choices)select.add(new Option(name,value));select.disabled=true;controls.append(select);selects.push([key,select]);
      select.addEventListener('change',async()=>{
        const before=await storage.get([fontKey,monoKey,emojiKey,geometryKey]);select.disabled=true;
        try{await storage.set({[key]:select.value});const saved=await storage.get([fontKey,monoKey,emojiKey,geometryKey]);if(saved[key]!==select.value)throw Error('Typography preference readback failed');apply(saved);select.title=label;}
        catch(error){select.value=before[key];select.title=String(error);}finally{select.disabled=false;}
      });
    }
    const advanced=document.createElement('details'),summary=document.createElement('summary');summary.textContent=zh?traditional?'排版':'排版':'Typography';advanced.append(summary);controls.append(advanced);
    const savedGeometry=await storage.get([geometryKey]);
    globalThis.ExtensionTypographyGeometry.mount(advanced,savedGeometry[geometryKey],async value=>{await storage.set({[geometryKey]:value});const saved=await storage.get([fontKey,monoKey,emojiKey,geometryKey]);if(JSON.stringify(saved[geometryKey])!==JSON.stringify(value))throw Error('Typography readback failed');apply(saved);},language);
    (document.querySelector('footer')??document.body).append(controls);
    try{const saved=await initial;for(const[key,select]of selects){select.value=saved[key];select.disabled=false;}}
    catch(error){for(const[,select]of selects)select.title=String(error);}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else void mount();
})();
