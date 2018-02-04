FROM node:9

WORKDIR /home/node/app

ADD index.js /home/node/app
ADD package.json /home/node/app

RUN npm install

USER node

EXPOSE 3000

CMD ["node", "index.js"]