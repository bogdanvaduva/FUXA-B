'use strict';

const basePath = require('../../basepath');

describe('basepath', () => {
    let expect;

    before(async () => {
        const chai = await import('chai');
        expect = chai.expect;
    });

    after(() => basePath.set(''));

    it('normalizes the configured value', () => {
        expect(basePath.normalize(undefined)).to.equal('');
        expect(basePath.normalize('')).to.equal('');
        expect(basePath.normalize('/')).to.equal('');
        expect(basePath.normalize('fuxa')).to.equal('/fuxa');
        expect(basePath.normalize('/fuxa/')).to.equal('/fuxa');
        expect(basePath.normalize(' //plant//fuxa// ')).to.equal('/plant/fuxa');
        expect(basePath.normalize('\\fuxa\\')).to.equal('/fuxa');
    });

    it('rejects values that are not a path', () => {
        expect(() => basePath.normalize('/fu xa')).to.throw();
        expect(() => basePath.normalize('/fuxa?x=1')).to.throw();
        expect(() => basePath.normalize('/fuxa"><script>')).to.throw();
    });

    it('keeps the value set at startup', () => {
        expect(basePath.set('/fuxa/')).to.equal('/fuxa');
        expect(basePath.get()).to.equal('/fuxa');
        expect(basePath.strip('/fuxa/api/settings')).to.equal('/api/settings');
    });

    it('strips the base path only as a whole segment', () => {
        expect(basePath.strip('/fuxa/editor', '/fuxa')).to.equal('/editor');
        expect(basePath.strip('/fuxa', '/fuxa')).to.equal('/');
        expect(basePath.strip('/fuxa2/editor', '/fuxa')).to.equal('/fuxa2/editor');
        expect(basePath.strip('/editor', '')).to.equal('/editor');
    });

    it('serves the Angular routes only below the base path', () => {
        expect(basePath.shouldBypassSpaCatchAll('/fuxa/editor', '/fuxa')).to.equal(false);
        expect(basePath.shouldBypassSpaCatchAll('/fuxa/home/main', '/fuxa')).to.equal(false);
        expect(basePath.shouldBypassSpaCatchAll('/editor', '/fuxa')).to.equal(true);
        expect(basePath.shouldBypassSpaCatchAll('/fuxa/api/project', '/fuxa')).to.equal(true);
        expect(basePath.shouldBypassSpaCatchAll('/fuxa/api-docs/', '/fuxa')).to.equal(true);
        expect(basePath.shouldBypassSpaCatchAll('/fuxa/socket.io/', '/fuxa')).to.equal(true);
        expect(basePath.shouldBypassSpaCatchAll('/fuxa/main.js', '/fuxa')).to.equal(true);
        expect(basePath.shouldBypassSpaCatchAll('/editor', '')).to.equal(false);
    });
});
