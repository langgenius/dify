import React, {useEffect, useRef, useState} from 'react';
import mermaid from 'mermaid';
import { t } from 'i18next';
import CryptoJS from 'crypto-js';

let mermaidAPI: any;
mermaidAPI = null;

if (typeof window !== 'undefined') {
  mermaid.initialize({
    startOnLoad: true,
    theme: 'default',
    flowchart: {
      htmlLabels: true,
      useMaxWidth: true,
    },
  });
  mermaidAPI = mermaid.mermaidAPI;
}


const Flowchart = React.forwardRef((props: {
  PrimitiveCode: string;
}, ref) => {
  const [svgCode, setSvgCode] = useState(null);
  const chartId = useRef(`flowchart_${CryptoJS.MD5(props.PrimitiveCode).toString()}`)
  const [isRender, setIsRender] = useState(true)
  const renderFlowchart = async (PrimitiveCode: string) => {
    try {
      const cachedSvg: any = localStorage.getItem(chartId.current);
      if (cachedSvg) {
        setSvgCode(cachedSvg);
        return;
      }

      if (typeof window !== 'undefined' && mermaidAPI) {
        const svgGraph = await mermaidAPI.render(chartId.current, PrimitiveCode);
        const base64Svg: any = await svgToBase64(svgGraph.svg);
        localStorage.setItem(chartId.current, base64Svg);
        setSvgCode(base64Svg);
      }
    } catch (error) {
      localStorage.clear();
      // @ts-ignore
      console.error(error.toString());
    }
  };

  const svgToBase64 = (svgGraph: string) => {
    const svgBytes = new TextEncoder().encode(svgGraph);
    const blob = new Blob([svgBytes], { type: 'image/svg+xml;charset=utf-8' });
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  useEffect(() => {
    setIsRender(false);
    setTimeout(() => {
      setIsRender(true);
      renderFlowchart(props.PrimitiveCode);
    }, 100)
  }, [props.PrimitiveCode]);

  const handleReRender = () => {
    setIsRender(false);
    setSvgCode(null);
    localStorage.removeItem(chartId.current);
    setTimeout(() => {
      setIsRender(true);
      renderFlowchart(props.PrimitiveCode);
    }, 100)
  };

  const style = {
    minWidth: '480px',
    height: 'auto',
    overflow: 'auto',
  };

  return (
    <div>
      {
        isRender && <div id={chartId.current} className="mermaid" style={style}>{svgCode && (<img src={svgCode} style={{width: '100%', height: 'auto'}} alt="Mermaid chart" />)}</div>
      }
      <button onClick={handleReRender}>{t('appApi.merMaind.rerender')}</button>
    </div>
  );
});

export default Flowchart;