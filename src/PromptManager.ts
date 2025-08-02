import { CodeblockCustomizerSettings } from "./Settings";
import { CBCParameters, getPromptDefinition, getPromptType, replacePromptTemplate, addClassesToPrompt, getPWD } from "./Utils";

type PromptCache = { key: string; node: HTMLElement | null };

export type PromptEnvironment = {
  dir: string;
  previousDir: string;
  user: string;
  host: string;
  db: string;
  branch: string;
  userStack?: string[];
  homeDir: string;
  originalHomeDir: string;
};// PromptEnvironment

export type PromptDefinition = {
  name: string;
  basePrompt: string;                         // Optional: example prompt for preview or fallback
  highlightGroups?: Record<string, string>;   // e.g., { user: "user", host: "host" }
  supportsRootStyling?: boolean;
  parsePromptRegex?: RegExp;                  // optional named-group regex
  parsePromptRegexString?: string;            // regex as string
  defaultDir?: string;
  defaultDb?: string;
  defaultUser?: string;
  defaultHost?: string;
  defaultBranch?: string;
  isWindowsShell: boolean;
  autoUsePrompt?: boolean;
  autoUseLanguages?: string[];
};// PromptDefinition

export enum PromptKind {
  Predefined = "predefined",
  Template = "template",
  Plain = "plain",
}// PromptKind

export const symbolClassMap: Record<string, string> = {
  "(": "prompt-bracket-open",
  ")": "prompt-bracket-close",
  "[": "prompt-square-open",
  "]": "prompt-square-close",
  "$": "prompt-dollar",
  ":": "prompt-colon",
  "@": "prompt-at",
  "-": "prompt-dash",
  "➜": "prompt-zsh-symbol",
  "✗": "prompt-zsh-status-error",
  "✓": "prompt-zsh-status-ok",
  ">": "prompt-greater-than",
  "#": "prompt-hash",
  "㉿": "prompt-kali-symbol",
  "%": "prompt-percent",
};// symbolClassMap

// used for settingspage
export const promptClassDisplayNames: Record<string, string> = {
  "prompt-user": "User",
  "prompt-host": "Host",
  "prompt-path": "Path",
  "prompt-db": "Database",
  "prompt-branch": "Branch",
  "prompt-symbol": "Symbol (fallback)",
  "prompt-dollar": "Dollar ($)",
  "prompt-at": "At (@)",
  "prompt-colon": "Colon (:)",
  "prompt-dash": "Dash (-)",
  "prompt-hash": "Hash (#)",
  "prompt-greater-than": "Greater Than (>)",
  "prompt-zsh-symbol": "ZSH Arrow (➜)",
  "prompt-zsh-status-error": "ZSH Error (✗)",
  "prompt-zsh-status-ok": "ZSH Ok (✓)",
  "prompt-kali-symbol": "Kali Symbol (㉿)",
  "prompt-square-open": "Square Bracket [",
  "prompt-square-close": "Square Bracket ]",
  "prompt-bracket-open": "Round Bracket (",
  "prompt-bracket-close": "Round Bracket )",
  "prompt-percent": "Percentage (%)",
};// promptClassDisplayNames

export const defaultPrompts: Record<string, PromptDefinition> = {
  bash: {
    name: "Bash",
    basePrompt: "{user}@{host}:{path}$",
    defaultDir: "~/",
    defaultUser: "user",
    defaultHost: "localhost",
    parsePromptRegex: /^(?<user>[^@]+)@(?<host>[^:]+):(?<path>.+?)([$#])$/,
    highlightGroups: {
      user: "user",
      host: "host",
      path: "path"
    },
    supportsRootStyling: true,
    isWindowsShell: false,
    autoUsePrompt: false,
    autoUseLanguages: [],
  },

  bashalt: {
    name: "Bash (alt)",
    basePrompt: "[{user}@{host} {path}]$",
    defaultDir: "~",
    defaultUser: "user",
    defaultHost: "localhost",
    parsePromptRegex: /^\[(?<user>[^@]+)@(?<host>[^ ]+) (?<path>.+?)\]([$#])$/,
    highlightGroups: {
      user: "user",
      host: "host",
      path: "path"
    },
    supportsRootStyling: true,
    isWindowsShell: false,
    autoUsePrompt: false,
    autoUseLanguages: [],
  },

  zshgit: {
    name: "Zsh + Git",
    basePrompt: "➜ {path} git:({branch}) ✗",
    defaultDir: "~/projects",
    defaultBranch: "main",
    defaultUser: "user",
    defaultHost: "localhost",
    parsePromptRegex: /^\s*(?<symbol>➜)\s+(?<path>.+?)\s+git:\((?<branch>.+?)\)(\s+(?<status>[✗✓]))?\s*$/,
    highlightGroups: {
      symbol: "zsh-symbol",
      path: "path",
      branch: "branch",
    },
    isWindowsShell: false,
    autoUsePrompt: false,
    autoUseLanguages: [],
  },

  zsh: {
    name: "Zsh",
    basePrompt: "{user}@{host} {path} %",
    defaultDir: "~/myapp",
    defaultUser: "user",
    defaultHost: "localhost",
    parsePromptRegex: /^(?<user>[^@]+)@(?<host>[^ ]+) (?<path>.+?)[%#]$/,
    highlightGroups: {
      user: "user",
      host: "host",
      path: "path",
    },
    supportsRootStyling: true,
    isWindowsShell: false,
    autoUsePrompt: false,
    autoUseLanguages: [],
  },

  kali: {
    name: "Kali Linux",
    basePrompt: "({user}㉿{host})-[{path}] $",
    defaultDir: "~",
    defaultUser: "kali",
    defaultHost: "kali",
    parsePromptRegex: /^\((?<user>[^㉿]+)㉿(?<host>[^)]+)\)-\[(?<path>[^\]]+)\]\s*([$#])$/,
    highlightGroups: {
      user: "user",
      host: "host",
      path: "path"
    },
    supportsRootStyling: true,
    isWindowsShell: false,
    autoUsePrompt: false,
    autoUseLanguages: [],
  },

  fish: {
    name: "Fish",
    basePrompt: "{path}>",
    defaultUser: "user",
    defaultHost: "localhost",
    defaultDir: "~/projects/myapp",
    parsePromptRegex: /^(?<path>.+)>$/,
    highlightGroups: {
      path: "path"
    },
    isWindowsShell: false,
    autoUsePrompt: false,
    autoUseLanguages: [],
  },

  ps: {
    name: "PowerShell",
    basePrompt: "PS {path}>",
    defaultUser: "Administrator",
    defaultHost: "localhost",
    defaultDir: "C:\\Users\\Administrator",
    parsePromptRegex: /^PS (?<path>.+)>$/,
    highlightGroups: {
      path: "path"
    },
    isWindowsShell: true,
    autoUsePrompt: false,
    autoUseLanguages: [],
  },

  cmd: {
    name: "CMD",
    basePrompt: "{path}>",
    defaultUser: "Administrator",
    defaultHost: "localhost",
    defaultDir: "C:\\Users\\Administrator",
    parsePromptRegex: /^(?<path>.+)>$/,
    highlightGroups: {
      path: "path"
    },
    isWindowsShell: true,
    autoUsePrompt: false,
    autoUseLanguages: [],
  },

  docker: {
    name: "Docker shell",
    basePrompt: "{user}@{host}:{path}$",
    defaultDir: "/var/www/html",
    defaultUser: "user",
    defaultHost: "container",
    parsePromptRegex: /^(?<user>[^@]+)@(?<host>[^:]+):(?<path>.+?)([$#])$/,
    highlightGroups: {
      user: "user",
      host: "host",
      path: "path"
    },
    supportsRootStyling: true,
    isWindowsShell: false,
    autoUsePrompt: false,
    autoUseLanguages: [],
  },

  postgres: {
    name: "PostgreSQL",
    basePrompt: "{db}=#",
    defaultDb: "postgres",
    parsePromptRegex: /^(?<db>.+)=#$/,
    highlightGroups: {
      db: "db"
    },
    isWindowsShell: false,
    autoUsePrompt: false,
    autoUseLanguages: [],
  }
};// defaultPrompts

interface PromptContext {
  promptType: string;
  promptDef: PromptDefinition;
  isCustom: boolean;
  actualPrompt: string;
  promptKind: PromptKind;
  settings: CodeblockCustomizerSettings;
}// PromptContext

interface PromptResult {
  promptData: string | { text: string; class?: string }[];
  newEnv: PromptEnvironment;
  newCache: PromptCache;
  node: HTMLElement;
  key: string;
}// PromptResult

export interface PromptLines {
  lineNumbers: number[];
  text: string;
  values: PromptValues;
}

interface PromptValues {
  user: string | null;
  host: string | null;
  path: string | null;
  db: string | null;
  branch: string | null;
}

interface CommandOutput {
  text: string;
  className: string;
}

export class PromptManager {
  private settings: CodeblockCustomizerSettings;
  private context: PromptContext;
  private promptEnv: PromptEnvironment;
  private cache: PromptCache;
  public readonly promptLines: Set<number>;

  constructor(parameters: CBCParameters, totalLines: number, settings: CodeblockCustomizerSettings) {
    this.settings = settings;
    this.promptLines = this.computePromptLines(parameters, totalLines, settings);
    const { context, initialEnv } = this.createPromptContext(parameters, settings);
    this.context = context;
    this.promptEnv = initialEnv;
    this.cache = { key: "", node: null };
  }

  public renderLine(lineText: string): { node: HTMLElement, key: string, output: CommandOutput[] } {
    const snapshot = { ...this.promptEnv };
    const result = this.renderPromptLine(lineText, snapshot, this.cache, this.context);

    this.promptEnv = result.newEnv;
    this.cache = result.newCache;
    
    const output = this.getCommandOutput(lineText, this.promptEnv);
    
    return { node: result.node, key: result.key, output };
  }// renderLine

  private getCommandOutput(lineText: string, env: PromptEnvironment): CommandOutput[] {
    const output: CommandOutput[] = [];
    if (/^\s*pwd\s*$/.test(lineText)) {
      output.push({ text: getPWD(env), className: `codeblock-customizer-prompt-cmd-output codeblock-customizer-workingdir` });
    }
    if (/^\s*whoami\s*$/.test(lineText)) {
      output.push({ text: env.user, className: `codeblock-customizer-prompt-cmd-output codeblock-customizer-whoami` });
    }
    return output;
  }// getCommandOutput

  private computePromptLines(parameters: CBCParameters, totalLines: number, settings: CodeblockCustomizerSettings): Set<number> {
    if (parameters.noprompt && parameters.nopromptLines.length === 0) {
      return new Set<number>();
    }

    const lines = new Set<number>();
    let promptText = parameters.prompt.text;

    if (!promptText && parameters.language) {
      const allPrompts = { ...defaultPrompts, ...settings.SelectedTheme.settings.prompts.customPrompts };
      for (const promptId in allPrompts) {
        const { def: promptDef } = getPromptDefinition(promptId, settings);
        if (promptDef.autoUsePrompt && promptDef.autoUseLanguages?.includes(parameters.language)) {
          promptText = promptId;
          parameters.prompt.text = promptId;
          break;
        }
      }
    }

    if (!promptText) 
      return lines;

    if (parameters.prompt.lineNumbers.length > 0) {
      for (const ln of parameters.prompt.lineNumbers) {
        lines.add(ln);
      }
    } else {
      for (let i = 1; i <= totalLines; i++) {
        lines.add(i);
      }
    }

    // remove lines specified by noprompt
    if (parameters.nopromptLines.length > 0) {
      for (const ln of parameters.nopromptLines) {
        lines.delete(ln);
      }
    }

    return lines;
  }// computePromptLines
  
  private parsePromptCommands(lineText: string, promptDef: PromptDefinition | undefined, env: PromptEnvironment): PromptEnvironment {
    const envCopy = { ...env };
    envCopy.userStack = [...(env.userStack ?? [])];

    const isWindowsShell = promptDef?.isWindowsShell ?? false;

    // cd
    const cdMatch = lineText.match(/^\s*cd\s*(.*)$/i);
    if (cdMatch) {
      let cdTarget = cdMatch[1].trim();
      if ((cdTarget.startsWith('"') && cdTarget.endsWith('"')) || (cdTarget.startsWith("'") && cdTarget.endsWith("'"))) {
        cdTarget = cdTarget.slice(1, -1);
      }

      let newDir = env.dir;
      if (cdTarget === "" || cdTarget === "~") {
        newDir = env.homeDir;
      } else if (cdTarget === "-") {
        const temp = env.dir;
        newDir = env.previousDir;
        envCopy.previousDir = temp;
      } else if (cdTarget === ".." || cdTarget === "cd..") {
        newDir = this.resolvePath(env.dir, "..", isWindowsShell, env.homeDir);
      } else {
        newDir = this.resolvePath(env.dir, cdTarget, isWindowsShell, env.homeDir);
      }

      if (newDir !== env.dir && cdTarget !== "-") {
        envCopy.previousDir = env.dir;
      }
      envCopy.dir = newDir;
    }

    // su
    const suMatch = lineText.match(/^\s*su\s*(\S*)/i);
    if (suMatch) {
      if (envCopy.userStack.length < 5) {
        envCopy.userStack.push(env.user);
      }
      
      envCopy.user = suMatch[1] || "root";
      if (isWindowsShell) {
        envCopy.homeDir = `C:\\Users\\${envCopy.user}`;
      } else {
        envCopy.homeDir = `/home/${envCopy.user}`;
      }
    }

    // exit
    if (/^\s*exit\s*$/i.test(lineText)) {
      if (envCopy.userStack.length > 0) {
        const prevUser = envCopy.userStack.pop();
        if (prevUser !== undefined) {
          envCopy.user = prevUser;
          if (isWindowsShell) {
            envCopy.homeDir = `C:\\Users\\${prevUser}`;
          } else {
            envCopy.homeDir = `/home/${prevUser}`;
          }
        }
      }
    }

    // db switch
    const dbMatch = lineText.match(/^\\c\s+(\S+)/);
    if (dbMatch) {
      envCopy.db = dbMatch[1];
    }

    // git branch switch
    const gitCheckout = lineText.match(/^\s*git\s+(checkout|switch)\s+(\S+)/i);
    if (gitCheckout) {
      envCopy.branch = gitCheckout[2];
    }

    return envCopy;
  }// parsePromptCommands

  private resolvePath(current: string, target: string, isWindows: boolean, homeDir?: string): string {
    const separator = isWindows ? "\\" : "/";
    const home = homeDir || (isWindows ? "C:\\Users\\User" : "/home/user");
  
    // cd "" or cd " " should do nothing, just return the current path
    if (target.trim() === "") {
      return current;
    }
    
    // cd (with no argument) or cd ~ should go to the home directory
    if (target === null || target === undefined || target.trim() === "~") {
      return "~";
    }
  
    let path_to_process: string;
    const isUNC = isWindows && (target.startsWith("\\\\") || target.startsWith("//"));
  
    if (isUNC) {
      path_to_process = "\\\\" + target.slice(2).replace(/[\\/]+/g, separator);
    } else {
      let resolvingTarget = target.replace(/[\\/]+/g, separator);
      if (resolvingTarget.startsWith("~" + separator)) {
        resolvingTarget = home + resolvingTarget.slice(1);
      }
  
      const isTargetAbsolute = isWindows ? /^[a-zA-Z]:\\/.test(resolvingTarget) || resolvingTarget.startsWith(separator) : resolvingTarget.startsWith(separator);
      if (isTargetAbsolute) {
        if (isWindows && resolvingTarget.startsWith(separator)) {
          path_to_process = current.substring(0, 2) + resolvingTarget;
        } else {
          path_to_process = resolvingTarget;
        }
      } else {
        let absoluteCurrent = current;
        if (current === "~" || current.startsWith("~" + separator)) {
          absoluteCurrent = home + current.slice(1);
        }
        path_to_process = absoluteCurrent + separator + resolvingTarget;
      }
    }
   
    let prefix: string;
    let parts: string[];
    const stack: string[] = [];
  
    if (isWindows && path_to_process.startsWith("\\\\")) { // UNC Path
      const pathParts = path_to_process.slice(2).split(separator);
      prefix = `\\\\${pathParts.shift() || ""}\\${pathParts.shift() || ""}`;
      parts = pathParts;
    } else if (isWindows) { // Standard Windows Path
      prefix = path_to_process.substring(0, path_to_process.indexOf(separator) + 1); // C:\
      parts = path_to_process.substring(prefix.length).split(separator);
    } else { // Linux Path
      prefix = "/";
      parts = path_to_process.substring(1).split(separator);
    }
  
    if(isWindows && !path_to_process.startsWith("\\\\")){
      stack.push(...prefix.split(separator).filter(p=>p && p.includes(':') === false));
    } else if (!isWindows){
        stack.push(...prefix.split(separator).filter(p=>p));
    }
  
    for (const part of parts) {
      if (part === ".." && stack.length > 0) {
        stack.pop();
      } else if (part && part !== "." && part !== "..") {
        stack.push(part);
      }
    }
  
    if (isWindows) {
      if (path_to_process.startsWith("\\\\")) { // rebuild UNC path
        return prefix + (stack.length > 0 ? separator + stack.join(separator) : separator);
      }
      // rebuild windows path, and ensure C:\ for root.
      return prefix.substring(0,2) + separator + stack.join(separator);
    } else { // rebuild linux path
      return prefix + stack.join(separator);
    }
  }// resolvePath

  private createPromptContext(parameters: CBCParameters, settings: CodeblockCustomizerSettings): { context: PromptContext; initialEnv: PromptEnvironment } {
    const promptType = parameters.prompt.text;
    const { def: promptDef, isCustom } = getPromptDefinition(promptType, settings);
    const promptKind = getPromptType(!isCustom ? promptType : promptDef.basePrompt);
    const actualPrompt = promptDef.basePrompt ?? promptType;
    const isWindowsShell = promptDef.isWindowsShell ?? false;
    const user = parameters.prompt.values?.user ?? promptDef.defaultUser ?? "user";
    const homeDir = isWindowsShell ? `C:\\Users\\${user}` : `/home/${user}`;
    const defaultDir = parameters.prompt.values?.path ?? promptDef.defaultDir ?? homeDir;

    const initialEnv: PromptEnvironment = {
      user,
      host: parameters.prompt.values?.host ?? promptDef.defaultHost ?? "localhost",
      dir: defaultDir,
      previousDir: defaultDir,
      db: parameters.prompt.values?.db ?? promptDef.defaultDb ?? "postgres",
      branch: parameters.prompt.values?.branch ?? "main",
      homeDir,
      originalHomeDir: homeDir,
      userStack: [],
    };

    return { context: { promptType, promptDef, isCustom, actualPrompt, promptKind, settings, }, initialEnv, };
  }// createPromptContext

  private renderPromptLine(lineText: string, snapshotEnv: PromptEnvironment, cache: PromptCache, ctx: PromptContext): PromptResult {
    const shellCmdRegex = /^\s*(cd\b|su\b|exit\b|git\b|\\c)/;
    // cache key
    const key = `${ctx.actualPrompt}|${this.promptEnvKey(snapshotEnv)}`;

    // re-render promptData
    const promptContent = replacePromptTemplate(ctx.promptKind, ctx.actualPrompt, ctx.promptDef, snapshotEnv);

    let node: HTMLElement;
    if (cache.key === key && cache.node) {
      node = cache.node.cloneNode(true) as HTMLElement;
    } else {
      const isRoot = snapshotEnv.user === "root";
      const newNode = addClassesToPrompt(promptContent, ctx.isCustom ? ctx.promptDef.name : ctx.promptType, ctx.promptDef, ctx.settings, isRoot);
      cache = { key, node: newNode };
      node = newNode.cloneNode(true) as HTMLElement;
    }

    const newEnv = shellCmdRegex.test(lineText) ? this.parsePromptCommands(lineText, ctx.promptDef, snapshotEnv) : snapshotEnv;

    return { promptData: promptContent, newEnv, newCache: cache, node, key};
  }// renderPromptLine

  private promptEnvKey(env: PromptEnvironment): string {
    return [env.user, env.dir, env.db, env.branch, env.host, env.previousDir].join('|');
  }// promptEnvKey
}// PromptManager