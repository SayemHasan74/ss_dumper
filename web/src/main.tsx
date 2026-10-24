import { render } from 'preact';
import './styles.css';

const root = document.getElementById('app');
if (!root) throw new Error('Application root is missing.');

render(<main><h1>Dump</h1></main>, root);
