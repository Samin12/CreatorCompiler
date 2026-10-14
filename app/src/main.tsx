import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './original-theme.css';
import {initializeAppearance} from './appearance';
initializeAppearance();

class Boundary extends React.Component<React.PropsWithChildren,{error:string}>{state={error:''};static getDerivedStateFromError(e:Error){return{error:e.message};}render(){return this.state.error?<div className="fatal"><h1>SceneForge needs a refresh</h1><p>{this.state.error}</p><button onClick={()=>location.reload()}>Reload workspace</button></div>:this.props.children;}}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Boundary><App/></Boundary></React.StrictMode>);
