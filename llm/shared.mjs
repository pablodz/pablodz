export const phases = [
  { title: 'Explorar', minutes: 15, prompt: '¿Qué resultado te gustaría poder delegar hoy?' },
  { title: 'Cuestionar', minutes: 20, prompt: '¿Qué estamos dando por hecho? ¿Cómo lo comprobaríamos?' },
  { title: 'Imaginar', minutes: 20, prompt: 'Trae tu contexto. Combina ideas. Describe un resultado más ambicioso.' },
  { title: 'Experimentar', minutes: 35, prompt: 'Elegimos un caso, trabajamos con el agente y contrastamos el resultado.' },
  { title: 'Desbloquear', minutes: 20, prompt: '¿Qué acceso, contexto, acompañamiento o créditos necesitas para probar?' },
  { title: 'Comprometer', minutes: 10, prompt: 'Define una primera prueba, cómo medirla y cuándo compartirás el resultado.' },
];

export const blockers = {
  approach: 'No sé por dónde empezar',
  context: 'Falta contexto o información',
  access: 'Faltan accesos',
  credits: 'Créditos o límites de uso',
  confidence: 'Lo intenté y no funcionó',
  time: 'Falta tiempo para experimentar',
};

export const scenarios = [
  {
    id: 'client-followup',
    title: 'Estar al frente del cliente',
    audience: 'FDE · Customer Success · Operaciones',
    question: '¿Para saber qué necesita un cliente tenemos que revisar manualmente sus conversaciones y pendientes?',
    choices: { manual: 'Lo reviso personalmente', assisted: 'Delego la recopilación y el resumen', delegated: 'Delego seguimiento y alertas con criterios', depends: 'Necesito más contexto para decidir' },
    context: ['¿Qué conversaciones y compromisos cuentan?', '¿Qué merece una alerta y quién debe recibirla?', '¿Cómo distinguimos urgencia de ruido?'],
    evidence: 'Probar con ejemplos normales, ambiguos y urgentes. Medir omisiones, falsas alertas y tiempo de seguimiento.',
  },
  {
    id: 'client-diagnosis',
    title: 'Entender lo que le pasa al cliente',
    audience: 'FDE · Soporte · Agentes conversacionales',
    question: '¿Para explicar una llamada fallida tengo que esperar a que alguien de ingeniería la investigue?',
    choices: { escalate: 'Escalo el caso completo', investigate: 'Delego el diagnóstico con evidencia', coordinate: 'Delego investigación y propuesta; coordino la solución', depends: 'Necesito más contexto para decidir' },
    context: ['¿Qué esperaba el cliente y qué ocurrió?', '¿Tenemos conversación, trazas, configuración y cambios recientes?', '¿Qué información falta antes de atribuir una causa?'],
    evidence: 'Reconstruir un caso, contrastar hipótesis y separar evidencia, explicación para el cliente y cambios pendientes.',
  },
  {
    id: 'business-validation',
    title: 'Validar resultados de negocio',
    audience: 'Operaciones · Producto · FDE',
    question: '¿La única forma de validar un reporte es comparar sus fuentes a mano?',
    choices: { manual: 'Comparo los datos manualmente', assisted: 'Delego cruces y detección de diferencias', delegated: 'Delego una validación repetible con reglas y evidencias', depends: 'Necesito más contexto para decidir' },
    context: ['¿Cuál es la fuente de verdad?', '¿Qué reglas, unidades y excepciones conoce el equipo?', '¿Qué diferencia cambiaría una decisión de negocio?'],
    evidence: 'Usar una muestra conocida, explicar cada diferencia y comprobar que los totales y las reglas de negocio coinciden.',
  },
  {
    id: 'local-testing',
    title: 'Desarrollar y probar con menos fricción',
    audience: 'Ingeniería · Plataforma · Personas que quieran contribuir',
    question: '¿Para desarrollar y probar cada cambio necesitamos un ambiente completo en Kubernetes?',
    choices: { local: 'Local completo', hybrid: 'Local + conexiones a servicios', cloud: 'Ambiente completo en la nube', depends: 'Necesito más contexto para decidir' },
    context: ['¿Qué dependencias y datos requiere el cambio?', '¿Qué podemos ejecutar localmente y qué necesita una conexión?', '¿Qué solo se puede validar con el comportamiento real del entorno?'],
    evidence: 'Diseñar una prueba local y otra de integración. Comprobar qué cubren, qué queda fuera y qué accesos son necesarios.',
  },
];

export class InputError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.status = status;
  }
}

export function textValue(value, max, required = false) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw new InputError('invalid_text');
  const text = value.trim();
  if (text.includes('\u0000') || text.length > max || (required && !text)) throw new InputError('invalid_length');
  return text;
}

export function enumValue(value, allowed, fallback) {
  const result = value ?? fallback;
  if (!allowed.includes(result)) throw new InputError('invalid_option');
  return result;
}

export function normalizeEntry(data) {
  return {
    kind: enumValue(data.kind, ['case', 'question'], 'case'),
    title: textValue(data.title, 160, true),
    context: textValue(data.context, 2000),
    outcome: textValue(data.outcome, 1200),
    assumption: textValue(data.assumption, 1200),
    verification: textValue(data.verification, 1000),
    blocker: enumValue(data.blocker, Object.keys(blockers), 'approach'),
    anonymous: data.anonymous === true,
  };
}

export function normalizeProfile(data) {
  const intentions = ['feature', 'fix', 'diagnosis', 'automation', 'exploration'];
  if (data.intentions !== undefined && (!Array.isArray(data.intentions) || data.intentions.some(item => !intentions.includes(item)))) {
    throw new InputError('invalid_option');
  }
  const minutes = Number(data.minutes || 0);
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 10000) throw new InputError('invalid_minutes');
  return {
    tools: textValue(data.tools, 400),
    readAccess: enumValue(data.readAccess, ['yes', 'no', 'unknown'], 'unknown'),
    mrAccess: enumValue(data.mrAccess, ['yes', 'no', 'unknown'], 'unknown'),
    intentions: [...new Set(data.intentions ?? [])],
    credits: enumValue(data.credits, ['enough', 'sometimes', 'blocked', 'unknown'], 'unknown'),
    limitType: enumValue(data.limitType, ['subscription', 'api', 'access', 'unknown'], 'unknown'),
    blockedTask: textValue(data.blockedTask, 1200),
    pilot: textValue(data.pilot, 1200),
    measure: textValue(data.measure, 1000),
    reviewDate: textValue(data.reviewDate, 10),
    frequency: textValue(data.frequency, 160),
    minutes,
  };
}

export function normalizeReflection(data) {
  const scenarioId = enumValue(data.scenarioId, scenarios.map(item => item.id), 'client-followup');
  const scenario = scenarios.find(item => item.id === scenarioId);
  return {
    scenarioId,
    beforeChoice: enumValue(data.beforeChoice, ['', ...Object.keys(scenario.choices)], ''),
    afterChoice: enumValue(data.afterChoice, ['', ...Object.keys(scenario.choices)], ''),
    assumption: textValue(data.assumption, 1200),
    contextNeeded: textValue(data.contextNeeded, 1200),
    experiment: textValue(data.experiment, 1600),
  };
}

export function normalizeUpdate(data) {
  const proofUrl = textValue(data.proofUrl, 1000);
  if (proofUrl) {
    let parsed;
    try { parsed = new URL(proofUrl); } catch { throw new InputError('invalid_url'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new InputError('invalid_url');
  }
  return {
    title: textValue(data.title, 160, true),
    body: textValue(data.body, 6000, true),
    entryId: data.entryId ? textValue(data.entryId, 36) : null,
    proofUrl,
  };
}
