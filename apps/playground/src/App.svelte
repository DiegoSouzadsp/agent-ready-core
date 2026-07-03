<script lang="ts">
  import { onMount } from 'svelte';
  import * as monaco from 'monaco-editor';
  import { AgentReady } from '@agent-ready/core';

  let editorContainer: HTMLDivElement;
  let editor: monaco.editor.IStandaloneCodeEditor;
  
  let validationOutput = '';
  let isValid = false;

  const defaultYaml = `schema_version: "0.1"
module: financeiro
operations:
  - id: OP-TEST
    name: teste_validador
    risk_level: free
    autonomy_policy: execute_immediately
    input_schema:
      valor:
        type: decimal
        required: true
        gt: 0
`;

  function validateSchema(yamlString: string) {
    try {
      // Validate the schema definition itself (basic parsing)
      const agent = AgentReady.fromYAML(yamlString);

      const opNames = agent.operations;
      if (opNames.length === 0) {
        isValid = false;
        validationOutput = "Schema válido, mas nenhuma operação encontrada.";
        return;
      }

      isValid = true;
      validationOutput = `✅ Schema Válido!\n\nMódulo: ${agent.schema.module}\nOperações encontradas:\n- ${opNames.join('\n- ')}\n\nExperimente adicionar regras de validação!`;

    } catch (e: any) {
      isValid = false;
      validationOutput = `❌ Erro de Validação:\n\n${e.message}`;
    }
  }

  onMount(() => {
    // Basic monaco setup
    editor = monaco.editor.create(editorContainer, {
      value: defaultYaml,
      language: 'yaml',
      theme: 'vs-dark',
      minimap: { enabled: false },
      automaticLayout: true
    });

    // Initial validation
    validateSchema(defaultYaml);

    // Listen to changes
    editor.onDidChangeModelContent(() => {
      validateSchema(editor.getValue());
    });
    
    return () => editor.dispose();
  });
</script>

<main class="playground">
  <div class="header">
    <h1>Agent-Ready Schema <span>Playground</span></h1>
  </div>
  
  <div class="split-view">
    <div class="editor-pane">
      <div bind:this={editorContainer} class="editor-container"></div>
    </div>
    <div class="preview-pane" class:error={!isValid}>
      <pre>{validationOutput}</pre>
    </div>
  </div>
</main>

<style>
  :global(body) {
    margin: 0;
    font-family: system-ui, -apple-system, sans-serif;
    background: #1e1e1e;
    color: #fff;
  }
  
  .playground {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }

  .header {
    padding: 1rem 2rem;
    background: #252526;
    border-bottom: 1px solid #333;
  }

  .header h1 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 500;
  }

  .header span {
    color: #4CAF50;
  }

  .split-view {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .editor-pane, .preview-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .editor-pane {
    border-right: 1px solid #333;
  }

  .editor-container {
    flex: 1;
  }

  .preview-pane {
    padding: 2rem;
    background: #1e1e1e;
    overflow-y: auto;
  }

  .preview-pane pre {
    white-space: pre-wrap;
    font-family: 'Fira Code', monospace;
    font-size: 14px;
    line-height: 1.5;
  }

  .preview-pane.error pre {
    color: #ff5252;
  }
</style>
