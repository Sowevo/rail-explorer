"""本地轮转日志：关联请求、行程状态和投影判断，不记录 Cookie 或完整几何。"""

import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
import time
import uuid

from flask import g, got_request_exception, has_request_context, request


def compact(value):
    if isinstance(value, dict):
        return {str(k): compact(v) for k, v in list(value.items())[:40]}
    if isinstance(value, (list, tuple)):
        result = [compact(v) for v in value[:200]]
        if len(value) > 200:
            result.append({'omitted': len(value) - 200})
        return result
    return value[:1000] if isinstance(value, str) else value


def text_fields(fields, prefix=''):
    """展开诊断字段，保持普通文本可读，并避免字段中的换行伪造日志。"""
    for key, value in fields.items():
        name = f'{prefix}.{key}' if prefix else str(key)
        if value is None or value == {} or value == []:
            continue
        if isinstance(value, dict):
            yield from text_fields(value, name)
        elif isinstance(value, (list, tuple)) and any(isinstance(item, dict) for item in value):
            for index, item in enumerate(value):
                yield from text_fields({str(index): item}, name)
        else:
            rendered = str(value).replace('\r', r'\r').replace('\n', r'\n')
            yield f'{name}={rendered}'


class TextFormatter(logging.Formatter):
    def format(self, record):
        data = dict(getattr(record, 'event_data', {}))
        event = str(data.pop('event', record.getMessage())).replace('\r', r'\r').replace('\n', r'\n')
        header = f'{self.formatTime(record)} {record.levelname} {event}'
        fields = list(text_fields(data))
        result = header + (' | ' + ' | '.join(fields) if fields else '')
        if record.exc_info:
            result += '\n' + self.formatException(record.exc_info)
        return result


def record_diagnostic(event, **fields):
    if has_request_context() and hasattr(g, 'rail_diagnostics'):
        g.rail_diagnostics.append({'event': event, **fields})


def configure_logging(app, directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / 'rail.log'
    handler = RotatingFileHandler(path, maxBytes=5 * 1024 * 1024, backupCount=3, encoding='utf-8')
    handler.setFormatter(TextFormatter())
    app.logger.addHandler(handler)
    app.logger.setLevel(logging.INFO)

    @app.before_request
    def begin_request():
        g.rail_request_id = uuid.uuid4().hex[:12]
        g.rail_started = time.monotonic()
        g.rail_diagnostics = []

    @app.after_request
    def finish_request(response):
        response.headers['X-Request-ID'] = g.rail_request_id
        if request.path.startswith('/static/') and response.status_code < 400:
            return response
        payload = request.get_json(silent=True) if request.is_json else None
        allowed = {'target_way', 'way_ids', 'way_id', 'point', 'direction', 'revision', 'reset', 'replace_current', 'side', 'source', 'dataset_version'}
        body = {k: v for k, v in payload.items() if k in allowed} if isinstance(payload, dict) else None
        result = response.get_json(silent=True) if response.is_json else None
        summary = {k: result[k] for k in ('error', 'code', 'current_way', 'choices', 'path', 'stop_reason', 'revision', 'dataset_version', 'manual_confirmation_required')
                   if k in result} if isinstance(result, dict) else None
        data = {'event': 'request', 'request_id': g.rail_request_id,
                'method': request.method, 'path': request.path,
                'query': compact(request.args.to_dict(flat=False)), 'body': compact(body),
                'status': response.status_code, 'duration_ms': round((time.monotonic() - g.rail_started) * 1000, 1),
                'result': compact(summary), 'diagnostics': compact(g.rail_diagnostics)}
        app.logger.log(logging.WARNING if response.status_code >= 400 else logging.INFO,
                       'request', extra={'event_data': data})
        return response

    def log_exception(sender, exception, **kwargs):
        app.logger.error('unhandled_exception', extra={'event_data': {
            'event': 'unhandled_exception', 'request_id': getattr(g, 'rail_request_id', None),
            'path': request.path}}, exc_info=(type(exception), exception, exception.__traceback__))

    got_request_exception.connect(log_exception, app, weak=False)
    return path
