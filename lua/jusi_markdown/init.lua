local M = {}
local root = debug.getinfo(1, 'S').source:sub(2):gsub('lua/jusi_markdown/init.lua$', '')
local config, registered

local function name_buffer(buf, path)
  if vim.b[buf].jusi_markdown_path == path then return end
  local base, occupied, existing = vim.fn.fnamemodify(path, ':t'), {}, {}
  local previous = vim.api.nvim_buf_get_name(buf)
  for _, other in ipairs(vim.api.nvim_list_bufs()) do
    existing[other] = true
    if other ~= buf then occupied[vim.api.nvim_buf_get_name(other)] = true end
  end
  local name, ordinal = base, 2
  while occupied[vim.fn.fnamemodify(name, ':p')] do
    name = base .. ' [' .. ordinal .. ']'; ordinal = ordinal + 1
  end
  vim.api.nvim_buf_set_name(buf, name)
  -- Renaming a nofile buffer may leave an unloaded alternate name artifact.
  for _, other in ipairs(vim.api.nvim_list_bufs()) do
    if not existing[other] and vim.api.nvim_buf_get_name(other) == previous
      and not vim.api.nvim_buf_is_loaded(other) and not vim.bo[other].buflisted and not vim.bo[other].modified then
      pcall(vim.api.nvim_buf_delete, other, {})
    end
  end
  vim.b[buf].jusi_markdown_path = path
  vim.cmd('redrawstatus')
end

function M.setup(opts)
  if registered and opts == nil then return end
  opts = opts or vim.g.jusi_markdown or {}
  assert(type(opts) == 'table', 'Markdown options must be a table')
  local node = opts.node or 'node'
  assert(type(node) == 'string' and node ~= '', 'node must be an executable name or path')
  local text_layer = opts.text_layer or 'auto'
  assert(text_layer == 'auto' or text_layer == 'off', 'Invalid Markdown text_layer')
  config = { node = node, text_layer = text_layer }
  if registered then return end
  local host = require('jusi_neovim')
  host.register({ id = 'markdown', api_version = 1, media_types = { 'text/markdown' }, open = function(request, ready)
    assert(request.target ~= '', 'Markdown file path required')
    local executable = vim.fn.exepath(config.node)
    assert(executable ~= '', 'Markdown Node executable not found: ' .. config.node)
    local target = request.target
    if target:sub(1, 2) == '~/' then target = vim.fn.expand('~') .. target:sub(2) end
    target = vim.fn.fnamemodify(target, ':p')
    local directory = vim.fn.tempname()
    vim.fn.mkdir(directory, 'p', 448)
    local metadata = directory .. '/document.json'
    local timer, dispose, stopped, positioned, opened_link
    local function close()
      if stopped then return end
      stopped = true
      if timer then timer:stop(); timer:close(); timer = nil end
      if dispose then dispose() end
      vim.fn.delete(directory, 'rf')
    end
    local launch = host.worker(function()
      return { executable = executable, argv = { root .. 'viewer.mjs', target, metadata },
        cwd = root, env = {}, ready_timeout_ms = 30000, text_timeout_ms = 30000,
        required_capabilities = { 'surface.web', 'text.extract', 'source.navigate', 'source.navigate.cursor', 'source.navigate.selection', 'surface.actions' } }
    end)
    local ok, result = pcall(launch, request, function(err, surface)
      ready(err, surface)
      if err then close(); return end
      vim.schedule(function()
        if stopped or not vim.api.nvim_buf_is_valid(request.buffer) then return end
        name_buffer(request.buffer, target)
        local function follow()
          local ticket = vim.b[request.buffer].jusi_document
          if not ticket then return end
          local cursor = vim.api.nvim_win_get_cursor(0)
          host.worker_action(('follow-link.%d.%d.%d'):format(ticket.revision, cursor[1], cursor[2]))
        end
        for _, key in ipairs({ '<CR>', '<C-j>' }) do
          vim.keymap.set('n', key, follow, { buffer = request.buffer, silent = true, desc = 'Markdown follow link at cursor or on this line' })
        end
        -- The installed worker owns this small private metadata file. Document
        -- JavaScript cannot write filenames or access this channel.
        local function refresh()
          if stopped then return end
          if not vim.api.nvim_buf_is_valid(request.buffer) then close(); return end
          local stat = vim.uv.fs_stat(metadata)
          if not stat or stat.size > 65536 then return end
          local success, data = pcall(function() return vim.json.decode(table.concat(vim.fn.readfile(metadata), '\n')) end)
          if success and type(data) == 'table' and type(data.path) == 'string' then
            name_buffer(request.buffer, data.path)
            local position = data.position
            if position and vim.b[request.buffer].jusi_worker_status == 'ready'
              and vim.deep_equal(position.ticket, vim.b[request.buffer].jusi_document)
              and position.id ~= positioned then
              positioned = position.id
              for _, win in ipairs(vim.fn.win_findbuf(request.buffer)) do
                vim.api.nvim_win_set_cursor(win, { position.row, position.column })
                if position.top then vim.api.nvim_win_call(win, function()
                  vim.fn.winrestview({ topline = position.row, lnum = position.row, col = position.column, leftcol = 0, skipcol = 0 })
                end) end
              end
              if vim.api.nvim_get_current_buf() == request.buffer then host.navigate() end
            end
            if data.external and data.external.id ~= opened_link then
              opened_link = data.external.id
              if vim.api.nvim_get_current_buf() == request.buffer then
                local opened, failure = pcall(function()
                  require('jusi_web').setup()
                  vim.cmd('tabnew')
                  host.open('web', data.external.url, { profile = request.options.profile, private = request.options.private })
                end)
                if not opened then vim.notify('Markdown link: ' .. tostring(failure), vim.log.levels.ERROR) end
              end
            end
          end
        end
        vim.api.nvim_buf_attach(request.buffer, false, { on_lines = function()
          if stopped then return true end
          vim.schedule(refresh)
        end })
        timer = vim.uv.new_timer()
        timer:start(0, 200, vim.schedule_wrap(refresh))
      end)
    end)
    if not ok then close(); error(result) end
    dispose = result
    return close
  end })
  vim.api.nvim_create_user_command('JusiMarkdown', function(args)
    host.open('markdown', args.args, { text_layer = args.bang and 'off' or config.text_layer })
  end, { nargs = 1, complete = 'file', bang = true })
  registered = true
end
return M
