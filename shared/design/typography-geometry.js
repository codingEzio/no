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
