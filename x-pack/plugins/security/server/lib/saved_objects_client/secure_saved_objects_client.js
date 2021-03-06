/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import { get, uniq } from 'lodash';
import { CHECK_PRIVILEGES_RESULT } from '../authorization/check_privileges';

export class SecureSavedObjectsClient {
  constructor(options) {
    const {
      errors,
      internalRepository,
      callWithRequestRepository,
      checkPrivileges,
      auditLogger,
      actions,
    } = options;

    this.errors = errors;
    this._internalRepository = internalRepository;
    this._callWithRequestRepository = callWithRequestRepository;
    this._checkPrivileges = checkPrivileges;
    this._auditLogger = auditLogger;
    this._actions = actions;
  }

  async create(type, attributes = {}, options = {}) {
    return await this._execute(
      type,
      'create',
      { type, attributes, options },
      repository => repository.create(type, attributes, options),
    );
  }

  async bulkCreate(objects, options = {}) {
    const types = uniq(objects.map(o => o.type));
    return await this._execute(
      types,
      'bulk_create',
      { objects, options },
      repository => repository.bulkCreate(objects, options),
    );
  }

  async delete(type, id, options = {}) {
    return await this._execute(
      type,
      'delete',
      { type, id, options },
      repository => repository.delete(type, id, options),
    );
  }

  async find(options = {}) {
    return await this._execute(
      options.type,
      'find',
      { options },
      repository => repository.find(options)
    );
  }

  async bulkGet(objects = [], options = {}) {
    const types = uniq(objects.map(o => o.type));
    return await this._execute(
      types,
      'bulk_get',
      { objects, options },
      repository => repository.bulkGet(objects, options)
    );
  }

  async get(type, id, options = {}) {
    return await this._execute(
      type,
      'get',
      { type, id, options },
      repository => repository.get(type, id, options)
    );
  }

  async update(type, id, attributes, options = {}) {
    return await this._execute(
      type,
      'update',
      { type, id, attributes, options },
      repository => repository.update(type, id, attributes, options)
    );
  }

  async _checkSavedObjectPrivileges(actions) {
    try {
      return await this._checkPrivileges(actions);
    } catch (error) {
      const { reason } = get(error, 'body.error', {});
      throw this.errors.decorateGeneralError(error, reason);
    }
  }

  async _execute(typeOrTypes, action, args, fn) {
    const types = Array.isArray(typeOrTypes) ? typeOrTypes : [typeOrTypes];
    const actions = types.map(type => this._actions.getSavedObjectAction(type, action));
    const { result, username, missing } = await this._checkSavedObjectPrivileges(actions);

    switch (result) {
      case CHECK_PRIVILEGES_RESULT.AUTHORIZED:
        this._auditLogger.savedObjectsAuthorizationSuccess(username, action, types, args);
        return await fn(this._internalRepository);
      case CHECK_PRIVILEGES_RESULT.LEGACY:
        return await fn(this._callWithRequestRepository);
      case CHECK_PRIVILEGES_RESULT.UNAUTHORIZED:
        this._auditLogger.savedObjectsAuthorizationFailure(username, action, types, missing, args);
        const msg = `Unable to ${action} ${[...types].sort().join(',')}, missing ${[...missing].sort().join(',')}`;
        throw this.errors.decorateForbiddenError(new Error(msg));
      default:
        throw new Error('Unexpected result from hasPrivileges');
    }
  }
}
