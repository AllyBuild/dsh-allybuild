/**
 * 显式注册全部所需 /client 包。loader.ts 作为首个 import 求值时已在
 * globalThis 装好 __ModuleLoader__；npm dist 的 /client 入口自带
 * __ModuleLoader__.load 注册副作用，而 vendored 源码入口是纯 ESM 插件面
 * （{ inject, apply }），故以命名空间导入（形状等价 npm dist 的
 * module.exports）后统一注册。
 */
import { registerModules } from './loader.ts'

import * as ClientConnection from '@deepseek-ai/dsh-client-connection/client'
import * as TypertRegistry from '@deepseek-ai/dsh-typert-registry/client'
import * as ApiGateway from '@deepseek-ai/dsh-api-gateway/client'
import * as ApiSessionController from '@deepseek-ai/dsh-api-session-controller/client'
import * as ApiWorkspaceController from '@deepseek-ai/dsh-api-workspace-controller/client'
import * as ApiRemotes from '@deepseek-ai/dsh-api-remotes/client'
import * as CordisClientRunner from '@deepseek-ai/dsh-cordis-client-runner/client'
import * as ClientLocale from '@deepseek-ai/dsh-client-locale/client'
import * as ClientShortcuts from '@deepseek-ai/dsh-client-shortcuts/client'
import * as ClientResources from '@deepseek-ai/dsh-client-resources/client'
import * as ClientFileUpload from '@deepseek-ai/dsh-client-file-upload/client'
import * as ClientUiTheme from '@deepseek-ai/dsh-client-ui-theme/client'
import * as ClientUiLayout from '@deepseek-ai/dsh-client-ui-layout/client'
import * as ClientUiRenderer from '@deepseek-ai/dsh-client-ui-renderer/client'
import * as ClientUiSession from '@deepseek-ai/dsh-client-ui-session/client'
import * as ClientUiWorkspace from '@deepseek-ai/dsh-client-ui-workspace/client'
import * as ClientUiSettings from '@deepseek-ai/dsh-client-ui-settings/client'
import * as ClientUiSidebarRight from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import * as ClientUiConversation from '@deepseek-ai/dsh-client-ui-conversation/client'
import * as ClientUiApproval from '@deepseek-ai/dsh-client-ui-approval/client'
import * as ClientUiChat from '@deepseek-ai/dsh-client-ui-chat/client'
import * as ClientUiDeliverables from '@deepseek-ai/dsh-client-ui-deliverables/client'
import * as ClientUiTool from '@deepseek-ai/dsh-client-ui-tool/client'
import * as ClientUiTrajectory from '@deepseek-ai/dsh-client-ui-trajectory/client'
import * as ClientUiUserQuestions from '@deepseek-ai/dsh-client-ui-user-questions/client'
import * as ClientUiInputTrigger from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import * as ClientUiCommands from '@deepseek-ai/dsh-client-ui-commands/client'
import * as ClientUiReference from '@deepseek-ai/dsh-client-ui-reference/client'

registerModules([
  ['@deepseek-ai/dsh-client-connection', ClientConnection],
  ['@deepseek-ai/dsh-typert-registry', TypertRegistry],
  ['@deepseek-ai/dsh-api-gateway', ApiGateway],
  ['@deepseek-ai/dsh-api-session-controller', ApiSessionController],
  ['@deepseek-ai/dsh-api-workspace-controller', ApiWorkspaceController],
  ['@deepseek-ai/dsh-api-remotes', ApiRemotes],
  ['@deepseek-ai/dsh-cordis-client-runner', CordisClientRunner],
  ['@deepseek-ai/dsh-client-locale', ClientLocale],
  ['@deepseek-ai/dsh-client-shortcuts', ClientShortcuts],
  ['@deepseek-ai/dsh-client-resources', ClientResources],
  ['@deepseek-ai/dsh-client-file-upload', ClientFileUpload],
  ['@deepseek-ai/dsh-client-ui-theme', ClientUiTheme],
  ['@deepseek-ai/dsh-client-ui-layout', ClientUiLayout],
  ['@deepseek-ai/dsh-client-ui-renderer', ClientUiRenderer],
  ['@deepseek-ai/dsh-client-ui-session', ClientUiSession],
  ['@deepseek-ai/dsh-client-ui-workspace', ClientUiWorkspace],
  ['@deepseek-ai/dsh-client-ui-settings', ClientUiSettings],
  ['@deepseek-ai/dsh-client-ui-sidebar-right', ClientUiSidebarRight],
  ['@deepseek-ai/dsh-client-ui-conversation', ClientUiConversation],
  ['@deepseek-ai/dsh-client-ui-approval', ClientUiApproval],
  ['@deepseek-ai/dsh-client-ui-chat', ClientUiChat],
  ['@deepseek-ai/dsh-client-ui-deliverables', ClientUiDeliverables],
  ['@deepseek-ai/dsh-client-ui-tool', ClientUiTool],
  ['@deepseek-ai/dsh-client-ui-trajectory', ClientUiTrajectory],
  ['@deepseek-ai/dsh-client-ui-user-questions', ClientUiUserQuestions],
  ['@deepseek-ai/dsh-client-ui-input-trigger', ClientUiInputTrigger],
  ['@deepseek-ai/dsh-client-ui-commands', ClientUiCommands],
  ['@deepseek-ai/dsh-client-ui-reference', ClientUiReference],
])
