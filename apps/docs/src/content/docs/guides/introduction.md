---
title: Introduction
description: Welcome to Agent-Ready Schema
---

**Agent-Ready Schema (ARS)** is an open-source governance layer for AI Agents. It acts as the bridge between an LLM's unpredictable output and your system's strict requirements.

## The Problem
When you expose your system to an LLM via protocols like MCP (Model Context Protocol), you give the LLM raw tools. But LLMs hallucinate, misunderstand context, or try to take actions they shouldn't. You end up writing complex prompts to try and "govern" the LLM's behavior.

## The Solution
ARS shifts the governance from the prompt to a declarative YAML schema. 
Before an LLM can execute an action, ARS intercepts it and applies:
1. **Strict Types & Constraints**: Ensure `valor` is > 0 and `descricao` has at least 3 characters.
2. **Contextual State Guards**: Prevent cancelling an order that's already shipped.
3. **Autonomy Policies**: Require human confirmation for actions over $500.

If validation fails, ARS doesn't just return an error. It returns a **Signpost** — rich, structured guidance that teaches the LLM *exactly* how to fix its mistake.
