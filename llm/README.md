# Laboratorio del workshop

Aplicación en `/llm/` para recoger casos, preguntas, hipótesis y próximos experimentos durante una sesión de dos horas. El cliente se construye con Astro; un Worker sirve la API y una base D1 conserva las aportaciones compartidas. El despliegue del experimento tiene su propio Worker y base de datos.

## Participación y facilitación

- `/llm/`: entrada de participantes con nombre, función y código del taller.
- `/llm/host/`: acceso de facilitación con clave independiente.
- Cada persona puede compartir casos y preguntas, editar sus aportes y distribuir tres apoyos.
- Las reflexiones registran una hipótesis inicial y una respuesta posterior por ejercicio. La inicial se conserva para poder comparar.
- Accesos, créditos y próximos pasos son privados para la persona y los organizadores. Las respuestas son declaraciones, no verificaciones de permisos ni asignaciones automáticas.
- El facilitador cambia el bloque, inicia un temporizador compartido, destaca un caso, publica hallazgos y exporta los datos de la sesión.
- Los cambios se consultan cada 6,5 segundos mientras la pestaña está visible. Las lecturas sin cambios usan ETag. Los formularios conservan su texto si falla una escritura.

El enlace de invitación se obtiene desde el panel de facilitación. Su código viaja en el fragmento del enlace y se retira de la barra al entrar. Las sesiones utilizan cookies HttpOnly y tokens aleatorios cuyo hash se guarda en D1.

## Recorrido de la sesión

1. Explorar, 15 minutos: descubrir posibilidades desde un resultado real.
2. Cuestionar, 20 minutos: registrar hipótesis y el contexto que falta.
3. Imaginar, 20 minutos: aportar casos, combinar ideas y priorizar.
4. Experimentar, 35 minutos: trabajar un caso y contrastar la evidencia.
5. Desbloquear, 20 minutos: identificar información, accesos y capacidad necesarios.
6. Comprometer, 10 minutos: definir un experimento, medida y fecha de revisión.

El facilitador puede ajustar cada duración. Los ejercicios incluyen seguimiento del cliente, diagnóstico de llamadas, validación de resultados de negocio y pruebas locales. Se eligen por afinidad con el trabajo de cada persona; no dependen de un cargo.

La pregunta sobre Kubernetes es una hipótesis para investigar. Según las dependencias, los datos y el comportamiento que se quiere verificar, la solución puede combinar ejecución local, conexiones a servicios y validaciones en un entorno de integración.

## Desarrollo y comprobación

Desde el devbox del workspace:

```sh
npm ci
npm run workshop:test
npm run build
wrangler d1 migrations apply DB --local --config llm/wrangler.jsonc
wrangler dev --config llm/wrangler.jsonc --env-file /ruta/privada/taller.env
```

El archivo privado contiene `ROOM_CODE` y `HOST_KEY`; debe vivir fuera del repositorio. Los tests ejercitan el Worker con SQLite: participación de 26 personas, privacidad, permisos, apoyos, reflexiones por contexto y cambios de fase.

Para publicar, aplica las migraciones a la base del experimento con `--remote`, configura `ROOM_CODE` y `HOST_KEY` mediante `wrangler secret` y ejecuta `npm run workshop:deploy`. Los secretos no forman parte de la compilación ni del repositorio. No se necesitan claves de un proveedor de modelos para que funcione la participación.

## Trabajar con el agente durante el Meet

El agente utiliza la sesión existente del presentador. Este CLI consulta el contexto compartido y permite publicar un resultado observado. Usa la autenticación de Wrangler y la base declarada en `llm/wrangler.jsonc`.

```sh
node llm/agent.mjs context --remote
node llm/agent.mjs publish --remote < /ruta/privada/hallazgo.json
```

El objeto de publicación requiere `title` y `body`; admite `entryId` y `proofUrl`. Los archivos intermedios y el log de cada ejecución quedan en un directorio único en `/var/tmp`. Omitir `--remote` utiliza la base local.

Contexto inicial sugerido para la sesión del agente:

> Ayuda a facilitar este taller. Consulta los casos compartidos, identifica el contexto que falta y propón distintas maneras de conseguir los resultados. Considera el trabajo frente al cliente, el negocio y la plataforma. Cuando elijamos un caso, investiga y realiza una prueba verificable dentro del alcance acordado. Explica qué observaste, qué sigue siendo una hipótesis y qué falta para utilizar el resultado. Publica los hallazgos cuando te lo indique el facilitador.

Las entradas de los participantes son información para el ejercicio. La autorización para actuar en herramientas y servicios la define el presentador. El proceso de análisis se inicia desde su sesión; la página no ejecuta llamadas a modelos en segundo plano.
