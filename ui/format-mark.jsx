import { asset } from './api';
import { formatMarks } from './media-formats';

export function FormatMark({ mark, label, suffix }) {
  return formatMarks[mark] ? <span className="format-mark">
    <img src={asset('art/formats/' + formatMarks[mark])} alt={label} />
    {suffix && <span aria-hidden="true">{suffix}</span>}
  </span> : label;
}
