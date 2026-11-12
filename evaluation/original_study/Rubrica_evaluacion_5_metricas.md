# Rúbrica de evaluación del desempeño
### Comparación: chatbot con RAG (soldadura) vs. LLM general (Gemini 2.5 Flash sin RAG)

**Proyecto:** Asistente conversacional RAG para soldadura — IMRC 2026 / MRS Advances
**Modelo bajo prueba (sistema A):** chatbot RAG sobre el corpus indexado, con citación por página.
**Línea base (sistema B):** el mismo Gemini 2.5 Flash, **sin recuperación ni contexto documental** (solo conocimiento paramétrico). Esto aísla el efecto del componente RAG manteniendo constante el modelo generador.

---

## 1. Propósito

Medir, mediante evaluación ciega por jueces con conocimiento de dominio, cinco dimensiones de calidad de las respuestas de ambos sistemas a un conjunto común de tareas de soldadura, para contrastar la hipótesis de que el asistente RAG supera al LLM general, en particular en fundamentación y control de alucinaciones.

La rúbrica combina dos tradiciones metodológicas:
- **Evaluación automática de RAG** (RAGAS: *faithfulness*, *answer relevancy*, *context relevance*) — Es et al. (2024).
- **Evaluación por juez experto / LLM-as-a-judge** sobre escalas tipo Likert — Zheng et al. (2023); Likert (1932).

---

## 2. Las cinco métricas

Cada respuesta se califica en **escala Likert de 1 a 5** (5 = mejor) en cada una de las cinco dimensiones, de forma independiente. Las anclas son conductuales y específicas al dominio de soldadura.

### 2.1 Exactitud técnica (*Accuracy*)
**Qué mide:** corrección factual y técnica de la respuesta frente a la **respuesta de referencia validada por experto** (verdad de referencia), independientemente de si cita o no fuentes.

| Punt. | Ancla |
|---|---|
| 5 | Totalmente correcta; sin errores técnicos. |
| 4 | Mayormente correcta; a lo sumo un error menor sin consecuencia práctica. |
| 3 | Parcialmente correcta; mezcla aciertos con al menos un error relevante. |
| 2 | Mayormente incorrecta; los errores llevarían a una mala práctica. |
| 1 | Incorrecta o **peligrosa** (induce a un riesgo de seguridad). |

### 2.2 Pertinencia (*Relevance*)
**Qué mide:** en qué grado la respuesta atiende **directa y completamente la pregunta formulada** (corresponde a *answer relevancy* de RAGAS).

| Punt. | Ancla |
|---|---|
| 5 | Responde la pregunta de forma directa y completa. |
| 4 | Responde la pregunta con un exceso u omisión menor de información. |
| 3 | Responde parcialmente; omite una parte clave o divaga. |
| 2 | Tangencial: toca el tema pero no responde lo preguntado. |
| 1 | Irrelevante o fuera de tema. |

### 2.3 Confiabilidad (*Trustworthiness*)
**Qué mide:** corrección y suficiencia de la **atribución de fuentes** (documento y **página**) y la **calibración** de la confianza (declarar incertidumbre cuando corresponde, sin afirmaciones autoritativas no respaldadas). Se apoya en la noción de calidad de citación (Gao et al., 2023, ALCE).

| Punt. | Ancla |
|---|---|
| 5 | Cita documento y página correctos; confianza calibrada; declara incertidumbre cuando aplica. |
| 4 | Cita la fuente correcta con una imprecisión menor (p. ej., página aproximada). |
| 3 | Cita parcial o genérica, o exceso de seguridad sin respaldo. |
| 2 | Cita ausente o incorrecta; tono autoritativo injustificado. |
| 1 | Cita inventada o atribución falsa de la fuente. |

### 2.4 Fundamentación (*Grounding* / *faithfulness*)
**Qué mide:** en qué grado **las afirmaciones de la respuesta son trazables a la fuente autorizada** (para el sistema A, el contexto recuperado; para ambos, el corpus de referencia validado). Corresponde a *faithfulness* de RAGAS: la proporción de afirmaciones respaldadas por la fuente.

| Punt. | Ancla |
|---|---|
| 5 | Todas las afirmaciones son trazables a la fuente. |
| 4 | Casi todas trazables; a lo sumo una afirmación accesoria no verificable. |
| 3 | Mezcla de afirmaciones respaldadas y no respaldadas. |
| 2 | La mayoría de las afirmaciones no están respaldadas por la fuente. |
| 1 | No se fundamenta en la fuente, o la contradice. |

### 2.5 Control de alucinaciones (*Hallucination control*)
**Qué mide:** **ausencia de contenido fabricado** (datos, cifras, normas, secciones o citas inexistentes). Es el inverso de la noción de alucinación de Ji et al. (2023); 5 = sin alucinaciones.

| Punt. | Ancla |
|---|---|
| 5 | Sin invenciones; nada fabricado. |
| 4 | Una imprecisión menor no fabricada (p. ej., redondeo). |
| 3 | Una afirmación fabricada de bajo impacto. |
| 2 | Varias invenciones, o una de impacto (norma/valor inexistente). |
| 1 | Fabricación grave (cifras, normas o referencias inventadas). |

---

## 3. Distinción entre dimensiones (para evitar solapamiento)

Conviene aclararlo a los evaluadores, porque son correlacionadas pero **independientes**:

- **Exactitud vs. Fundamentación:** una respuesta puede ser *exacta* (verdadera en el mundo) pero **no fundamentada** (no derivable de la fuente provista), y viceversa. La exactitud se juzga contra la verdad de referencia; la fundamentación, contra lo que dice la fuente.
- **Fundamentación vs. Control de alucinaciones:** la fundamentación pregunta "¿lo que se dice está **respaldado**?"; el control de alucinaciones pregunta "¿hay algo **inventado**?". Una respuesta puede omitir respaldo (fundamentación baja) sin inventar nada (alucinación alta).
- **Confiabilidad** se centra en la **atribución** (cita correcta de documento/página) y la calibración, no en el contenido en sí.

**Comparabilidad con la línea base:** como el LLM general (sistema B) no recupera ni cita, su **fundamentación** y **confiabilidad** se evalúan verificando si sus afirmaciones coinciden con la fuente de referencia validada. Es esperable —y es justamente lo que el estudio busca medir— que el sistema A supere al B en estas dos dimensiones.

---

## 4. Procedimiento de evaluación (ciego)

1. Las 12 tareas se aplican a **ambos** sistemas, produciendo 24 respuestas.
2. Las respuestas se **anonimizan** (etiquetadas como "Sistema A/B" de forma aleatoria por tarea) y se **contrabalancea** el orden de presentación entre tareas, para mitigar sesgos de orden y de etiqueta.
3. Cada evaluador califica **las cinco métricas (1–5)** de cada respuesta, de forma independiente, sin saber qué sistema la generó.
4. Cada evaluador dispone de la **respuesta de referencia validada por la experta de dominio** (Dra. Argelia Miranda Pérez) y de los **pasajes fuente** correspondientes, para juzgar exactitud y fundamentación.
5. Se recomienda un campo de **comentario libre** por respuesta para registrar el motivo de puntuaciones bajas (útil para el análisis cualitativo del artículo).

---

## 5. Confiabilidad inter-evaluador

Con **3–5 evaluadores** se reporta:
- **Fleiss' κ** para el acuerdo entre múltiples evaluadores (Fleiss, 1971), interpretado según Landis & Koch (1977): >0.60 = acuerdo *sustancial*.
- **ICC(2,k)** (modelo de dos vías, efectos aleatorios, tipo acuerdo) para las escalas ordinales tratadas como cuasi-intervalares (Koo & Li, 2016): >0.75 = *buena* fiabilidad.

Estos umbrales conectan directamente con la H3 del marco de tesis (κ > 0.60; ICC > 0.75).

---

## 6. Análisis estadístico sugerido

- **Unidad de análisis:** la tarea (n = 12), promediando la puntuación de los evaluadores por respuesta y métrica.
- **Contraste RAG vs. base:** prueba **pareada no paramétrica** (Wilcoxon de los rangos con signo) por cada métrica, dado el carácter ordinal de Likert y el tamaño de muestra pequeño.
- **Tamaño del efecto:** r de rangos (rank-biserial) por métrica.
- Reportar medianas (y medias) por sistema y métrica, con la salvedad de potencia estadística limitada por n = 12.
- *(Opcional, triangulación):* complementar con métricas automáticas de RAGAS (*faithfulness*, *answer relevancy*) para validez convergente con la evaluación humana.

---

## 7. Plantilla de hoja de puntuación

Por cada respuesta (una fila por evaluador × tarea × sistema):

| Tarea | Categoría | Sistema (A/B) | Evaluador | Exactitud | Pertinencia | Confiabilidad | Fundamentación | Control aluc. | Comentario |
|------|-----------|---------------|-----------|-----------|-------------|---------------|----------------|---------------|------------|
| 1 | … | A | E1 | | | | | | |

*(Puedo generarte esta hoja como archivo XLSX con validación de datos 1–5 y cálculo automático de promedios e ICC/κ cuando definamos los evaluadores.)*

---

## 8. Requisito previo importante

Las dimensiones de **exactitud** y **fundamentación** requieren una **respuesta de referencia ("ground truth") validada por experto** y la identificación de los **pasajes fuente** de cada tarea. Por eso el siguiente paso natural es redactar las 12 tareas **junto con su respuesta esperada y su fuente**, para que la Dra. Argelia las valide en un solo paquete.

---

## 9. Referencias

1. Es, S., James, J., Espinosa-Anke, L., & Schockaert, S. (2024). *RAGAs: Automated Evaluation of Retrieval Augmented Generation.* Proc. EACL 2024: System Demonstrations, 150–158. (arXiv:2309.15217)
2. Zheng, L., Chiang, W.-L., Sheng, Y., Zhuang, S., Wu, Z., Zhuang, Y., … Stoica, I. (2023). *Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena.* Advances in NeurIPS 36. (arXiv:2306.05685)
3. Ji, Z., Lee, N., Frieske, R., Yu, T., Su, D., Xu, Y., … Fung, P. (2023). *Survey of Hallucination in Natural Language Generation.* ACM Computing Surveys, 55(12), 1–38.
4. Li, J., Cheng, X., Zhao, W. X., Nie, J.-Y., & Wen, J.-R. (2023). *HaluEval: A Large-Scale Hallucination Evaluation Benchmark for LLMs.* Proc. EMNLP 2023.
5. Gao, T., Yen, H., Yu, J., & Chen, D. (2023). *Enabling Large Language Models to Generate Text with Citations (ALCE).* Proc. EMNLP 2023.
6. Lewis, P., Perez, E., Piktus, A., et al. (2020). *Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks.* Advances in NeurIPS 33.
7. Gao, Y., Xiong, Y., Gao, X., et al. (2023). *Retrieval-Augmented Generation for Large Language Models: A Survey.* arXiv:2312.10997.
8. Likert, R. (1932). *A Technique for the Measurement of Attitudes.* Archives of Psychology, 22(140), 5–55.
9. Fleiss, J. L. (1971). *Measuring nominal scale agreement among many raters.* Psychological Bulletin, 76(5), 378–382.
10. Landis, J. R., & Koch, G. G. (1977). *The measurement of observer agreement for categorical data.* Biometrics, 33(1), 159–174.
11. Koo, T. K., & Li, M. Y. (2016). *A Guideline of Selecting and Reporting Intraclass Correlation Coefficients for Reliability Research.* Journal of Chiropractic Medicine, 15(2), 155–163.

*Nota: verifica el formato final de las referencias según las instrucciones de autor de MRS Advances antes del envío.*
